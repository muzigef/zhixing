import type { ModelEvent, ModelRole, ModelToolDefinition, ModelTurn, ToolResultMessage } from "./model.js";
import { assertExternalContentAllowed } from "./external-content-gate.js";
import { ProviderRuntime } from "./provider-runtime.js";
import { createModelAudit, type ModelAuditRecord } from "./model-audit.js";
import { AgentLoop } from "./agent-loop.js";
import { abortable } from "./abortable.js";

/** Runtime-enforced resource bounds; these values never come from model output. */
export interface InvocationLimits {
  readonly maxTurns: number;
  readonly maxToolCalls: number;
  readonly maxEvents: number;
  readonly maxOutputChars: number;
  readonly maxContextChars: number;
  readonly timeoutMs: number;
}
const DEFAULT_LIMITS: InvocationLimits = { maxTurns: 6, maxToolCalls: 32, maxEvents: 10_000, maxOutputChars: 64_000, maxContextChars: 128_000, timeoutMs: 180_000 };

export interface InvocationRequest {
  readonly role: ModelRole;
  readonly prompt: string;
  readonly providerId: string;
  readonly containsUserMaterials: boolean;
  readonly confirmed: boolean;
  /** Synchronous return values are ignored; Promise returns preserve trace ordering. */
  readonly onAudit?: (record: ModelAuditRecord) => unknown | Promise<unknown>;
  readonly onText?: (text: string, providerId: string) => void;
  readonly onToolCall?: (tool: string, input: unknown, signal: AbortSignal) => Promise<unknown>;
  readonly onToolResult?: (tool: string, result: unknown) => void;
  readonly allowFallback?: boolean;
  readonly tools?: readonly ModelToolDefinition[];
  readonly limits?: Partial<InvocationLimits>;
  readonly requireDone?: boolean;
}

/** A partial result is never a successful completion of the requested task. */
export interface InvocationResult {
  readonly text: string;
  readonly events: number;
  readonly providerId: string;
  readonly toolResults: ToolResultMessage[];
  readonly partial?: boolean;
  readonly stopReason?: string;
}

/** Runs bounded model/tool turns with consent, cancellation and one audit record. */
export async function collectInvocation(runtime: ProviderRuntime, request: InvocationRequest, parent: AbortSignal): Promise<InvocationResult> {
  assertExternalContentAllowed(request);
  const limits = { ...DEFAULT_LIMITS, ...request.limits };
  if (Object.values(limits).some((value) => !Number.isSafeInteger(value) || value <= 0)) throw new Error("invocation_limits_invalid");
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("invocation_timeout")), limits.timeoutMs);
  const signal = AbortSignal.any([parent, controller.signal]);
  const providers = runtime.forInvocation(request.role);
  let text = "";
  let events = 0;
  let actualProviderId = request.providerId;
  const toolResults: ToolResultMessage[] = [];
  const history: ModelTurn[] = [];
  const callIds = new Set<string>();
  let turns = 0;
  let toolCalls = 0;
  let contextChars = request.prompt.length + JSON.stringify(request.tools ?? []).length;
  let stopReason: string | undefined;
  let failure: unknown;
  const loop = new AgentLoop(limits.maxTurns);
  try {
    for (;;) {
      signal.throwIfAborted();
      // A provider may start work when constructing its iterable, before next().
      if (turns >= limits.maxTurns) throw new Error("max_turns");
      if (contextChars > limits.maxContextChars) throw new Error("model_input_limit");
      const previous = history.at(-1);
      const options = { tools: request.tools, history };
      const stream = previous
        ? providers.continue(request.role, request.prompt, previous.toolResults, signal, (id) => { actualProviderId = id; }, options)
        : providers.stream(request.role, request.prompt, signal, (id) => { actualProviderId = id; }, request.allowFallback ?? true, options);
      if (!stream) { stopReason = "provider_continuation_unsupported"; break; }
      const stop = loop.turn();
      if (stop) throw new Error(stop);
      turns += 1;
      const turnEvents: ModelEvent[] = [];
      const calls: ModelEvent[] = [];
      const iterator = stream[Symbol.asyncIterator]();
      let completed = false;
      try {
        for (;;) {
          const next = await abortable(() => iterator.next(), signal);
          if (next.done) break;
          signal.throwIfAborted();
          const event = next.value;
          events += 1;
          if (events > limits.maxEvents) throw new Error("model_event_limit");
          if (event.type === "done") { completed = true; break; }
          if (event.type === "tool_result") throw new Error("untrusted_tool_result");
          if (event.type === "text_delta") {
            if (typeof event.text !== "string") continue;
            if (text.length + event.text.length > limits.maxOutputChars) throw new Error("model_output_limit");
            text += event.text;
            contextChars += event.text.length;
            request.onText?.(event.text, actualProviderId);
          } else if (event.type === "tool_call") {
            if (!request.onToolCall) throw new Error("tool_dispatcher_required");
            if (!event.tool) throw new Error("provider_protocol_error");
            toolCalls += 1;
            if (toolCalls > limits.maxToolCalls) throw new Error("max_tool_calls");
            const duplicate = loop.tool(event.tool, event.input);
            if (duplicate) throw new Error(duplicate);
            if (event.callId && callIds.has(event.callId)) throw new Error("provider_protocol_error");
            if (event.callId) callIds.add(event.callId);
            contextChars += JSON.stringify(event.input ?? null).length;
            calls.push(event);
          }
          if (contextChars > limits.maxContextChars) throw new Error("model_input_limit");
          turnEvents.push(event);
        }
      } finally {
        // An uncooperative iterator may never finish return(); don't hold cancellation.
        if (signal.aborted) void iterator.return?.().catch(() => undefined);
        else if (iterator.return) await abortable(() => iterator.return!(), signal);
      }
      if (request.requireDone && !completed) throw new Error("provider_incomplete");
      const results: ToolResultMessage[] = [];
      // No side effects until the entire provider turn has passed protocol/budget checks.
      for (const call of calls) {
        signal.throwIfAborted();
        let result: unknown;
        if (request.tools && !request.tools.some((tool) => tool.name === call.tool)) result = { ok: false, errorCode: "tool_not_allowed" };
        else {
          try { result = await abortable(() => request.onToolCall!(call.tool!, call.input, signal), signal); }
          catch (error) {
            if (signal.aborted) throw error;
            // Tool failures are observations the model can act on, not invented successes.
            result = { ok: false, errorCode: "tool_failed" };
          }
        }
        signal.throwIfAborted();
        const serialized = JSON.stringify(result ?? null);
        if (serialized === undefined) throw new Error("tool_output_invalid");
        const bounded = serialized.length > 12_000 ? { truncated: true, preview: serialized.slice(0, 12_000) } : result ?? null;
        const message: ToolResultMessage = { tool: call.tool!, result: bounded, ...(call.callId ? { callId: call.callId } : {}) };
        contextChars += JSON.stringify(bounded).length;
        toolResults.push(message);
        results.push(message);
        request.onToolResult?.(message.tool, message.result);
      }
      if (!results.length) break;
      history.push({ events: turnEvents, toolResults: results });
    }
    signal.throwIfAborted();
  } catch (error) {
    failure = parent.aborted ? new DOMException("cancelled", "AbortError") : controller.signal.aborted ? new Error("invocation_timeout") : error;
    const code = failure instanceof Error ? failure.message.split(":", 1)[0] : "";
    // Preserve visible partial text only for transport interruption, with a truthful status.
    if (!parent.aborted && text.trim() && ["provider_timeout", "provider_incomplete", "invocation_timeout"].includes(code ?? "")) {
      stopReason = code;
      failure = undefined;
    }
  } finally { clearTimeout(timer); }
  await request.onAudit?.(createModelAudit(actualProviderId, request.role, startedAt, parent.aborted ? "cancelled" : failure || stopReason ? "error" : "success", { events, turns, toolCalls }));
  if (failure) throw failure;
  return { text, events, providerId: actualProviderId, toolResults, ...(stopReason ? { partial: true, stopReason } : {}) };
}
