import type { ContinuableModelClient, ModelEvent, ModelRequestOptions, ToolResultMessage } from "./model.js";
import { assertLiveProviderAllowed } from "./provider-policy.js";
import type { SecretStore } from "./secret-store.js";
import { abortable } from "./abortable.js";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
const MAX_SSE_FRAME_BYTES = 64 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
type WireTool = { id: string; type: "function"; function: { name: string; arguments: string } };
type WireMessage = { role: "user" | "assistant" | "tool"; content: string | null; tool_calls?: WireTool[]; tool_call_id?: string };
type Delta = { content?: string | null; tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }> };
type Payload = { error?: unknown; choices?: Array<{ delta?: Delta; message?: Delta; finish_reason?: string | null }> };

/** Stateless, bounded text/tool adapter. Every request carries its own conversation. */
export class DeepSeekClient implements ContinuableModelClient {
  constructor(
    private readonly secrets: SecretStore,
    private readonly fetcher: FetchLike = fetch,
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly model = environment.ZHIXING_DEEPSEEK_MODEL ?? "deepseek-v4-flash",
    private readonly endpoint = "https://api.deepseek.com/v1/chat/completions",
    private readonly timeoutMs = 60_000,
  ) {}

  stream(prompt: string, signal: AbortSignal, options?: ModelRequestOptions): AsyncIterable<ModelEvent> {
    return this.request(prompt, signal, options);
  }

  continue(prompt: string, _results: readonly ToolResultMessage[], signal: AbortSignal, options?: ModelRequestOptions): AsyncIterable<ModelEvent> {
    if (!options?.history?.length) throw new Error("provider_continuation_context_required");
    return this.request(prompt, signal, options);
  }

  private async *request(prompt: string, parent: AbortSignal, options?: ModelRequestOptions): AsyncIterable<ModelEvent> {
    if (parent.aborted) throw new DOMException("cancelled", "AbortError");
    assertLiveProviderAllowed(this.environment);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = AbortSignal.any([parent, timeout]);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const key = await abortable(() => this.secrets.get("keychain:zhixing/deepseek-api"), signal);
      if (!key) throw new Error("provider_unavailable: deepseek-api 未配置");
      const messages = wireHistory(prompt, options);
      const response = await abortable(() => this.fetcher(this.endpoint, {
        method: "POST", signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        // Disable thinking explicitly: this adapter carries visible messages and
        // tool calls, not a provider-specific reasoning transcript.
        body: JSON.stringify({ model: this.model, messages, stream: true, thinking: { type: "disabled" },
          ...(options?.tools?.length ? { tools: options.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })) } : {}),
        }),
      }), signal);
      if (!response.ok) {
        void response.body?.cancel().catch(() => undefined);
        throw new Error(`provider_unavailable: deepseek HTTP ${response.status}`);
      }
      if (!response.body) throw new Error("provider_protocol_error: missing body");
      reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let bytes = 0;
      let completed = false;
      let finishReason: string | undefined;
      let hasText = false;
      const calls = new Map<number, WireTool>();
      const consume = function* (payload: Payload): Generator<ModelEvent> {
        if (!payload || payload.error || !Array.isArray(payload.choices)) throw new Error("provider_protocol_error");
        const choice = payload.choices[0];
        if (!choice) return; // Usage-only chunks may have no choices.
        const delta = choice.delta ?? choice.message;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        if (!delta) return;
        if (delta.content != null && typeof delta.content !== "string") throw new Error("provider_protocol_error");
        if (delta.content) { hasText = true; yield { type: "text_delta", text: delta.content }; }
        if (delta.tool_calls !== undefined && !Array.isArray(delta.tool_calls)) throw new Error("provider_protocol_error");
        for (const [position, part] of (delta.tool_calls ?? []).entries()) {
          const index = part.index ?? (choice.message ? position : undefined);
          if (!Number.isInteger(index) || index! < 0 || index! >= 32) throw new Error("provider_protocol_error");
          const call = calls.get(index!) ?? { id: "", type: "function", function: { name: "", arguments: "" } };
          if (part.id) call.id += part.id;
          if (part.function?.name) call.function.name += part.function.name;
          if (part.function?.arguments) call.function.arguments += part.function.arguments;
          if (call.id.length > 200 || call.function.name.length > 64 || Buffer.byteLength(call.function.arguments) > MAX_SSE_FRAME_BYTES) throw new Error("provider_output_limit");
          calls.set(index!, call);
        }
      };
      if (response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) {
        for (;;) {
          const next = await abortable(() => reader!.read(), signal);
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) throw new Error("provider_output_limit");
          buffer += decoder.decode(next.value, { stream: true });
          let separator: RegExpExecArray | null;
          while ((separator = /\r?\n\r?\n/.exec(buffer))) {
            const frame = buffer.slice(0, separator.index);
            buffer = buffer.slice(separator.index + separator[0].length);
            if (Buffer.byteLength(frame) > MAX_SSE_FRAME_BYTES) throw new Error("provider_output_limit");
            const data = frame.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n").trim();
            if (!data) continue; // SSE comments/heartbeats are not JSON payloads.
            if (data === "[DONE]") { completed = true; break; }
            yield* consume(parsePayload(data));
          }
          if (completed) break;
          if (Buffer.byteLength(buffer) > MAX_SSE_FRAME_BYTES) throw new Error("provider_output_limit");
        }
        if (!completed) throw new Error("provider_incomplete");
      } else {
        for (;;) {
          const next = await abortable(() => reader!.read(), signal);
          if (next.done) break;
          bytes += next.value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) throw new Error("provider_output_limit");
          buffer += decoder.decode(next.value, { stream: true });
        }
        buffer += decoder.decode();
        yield* consume(parsePayload(buffer));
      }
      signal.throwIfAborted();
      if (finishReason && !["stop", "tool_calls"].includes(finishReason)) throw new Error("provider_incomplete");
      if (!hasText && !calls.size) throw new Error("provider_unavailable: deepseek 空响应");
      const ids = new Set<string>();
      // Validate the entire batch before yielding any executable request.
      const events: ModelEvent[] = [];
      for (const [, call] of [...calls.entries()].sort(([a], [b]) => a - b)) {
        if (!call.id || !/^[a-zA-Z0-9_-]{1,64}$/.test(call.function.name) || ids.has(call.id)) throw new Error("provider_protocol_error");
        ids.add(call.id);
        let input: unknown;
        try { input = JSON.parse(call.function.arguments); } catch { throw new Error("provider_protocol_error: invalid tool arguments"); }
        events.push({ type: "tool_call", callId: call.id, tool: call.function.name, input });
      }
      yield* events;
      yield { type: "done" };
    } catch (error) {
      if (parent.aborted) throw new DOMException("cancelled", "AbortError");
      if (timeout.aborted) throw new Error("provider_timeout: deepseek-api 请求超时");
      if (error instanceof Error && error.message.startsWith("provider_")) throw error;
      // Network exceptions can contain authorization headers or request content.
      throw new Error("provider_unavailable: deepseek-api 请求或读取失败");
    } finally {
      // Some custom streams never settle cancellation; cleanup must not hold the run.
      void reader?.cancel().catch(() => undefined);
    }
  }
}

function parsePayload(data: string): Payload {
  try { return JSON.parse(data) as Payload; } catch { throw new Error("provider_protocol_error: invalid JSON"); }
}

function wireHistory(prompt: string, options?: ModelRequestOptions): WireMessage[] {
  const messages: WireMessage[] = [{ role: "user", content: prompt }];
  for (const turn of options?.history ?? []) {
    const calls = turn.events.filter((event) => event.type === "tool_call");
    const tools: WireTool[] = calls.map((call) => {
      if (!call.callId || !call.tool) throw new Error("provider_protocol_error: missing call id");
      return { id: call.callId, type: "function", function: { name: call.tool, arguments: JSON.stringify(call.input ?? {}) } };
    });
    messages.push({ role: "assistant", content: turn.events.filter((event) => event.type === "text_delta").map((event) => event.text ?? "").join("") || null, tool_calls: tools });
    for (const call of calls) {
      const result = turn.toolResults.find((item) => item.callId === call.callId && item.tool === call.tool);
      if (!result) throw new Error("provider_protocol_error: missing tool result");
      messages.push({ role: "tool", tool_call_id: call.callId, content: JSON.stringify(result.result ?? null) });
    }
  }
  return messages;
}
