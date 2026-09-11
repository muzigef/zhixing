import { abortable } from "./abortable.js";
import type { ApiConnection } from "./api-connection-config.js";
import type { FetchLike } from "./chat-completions-client.js";
import type { ContinuableModelClient, ModelEvent, ModelRequestOptions, ToolResultMessage } from "./model.js";
import { adapterCapabilities, outputTokenLimit } from "./model-capabilities.js";
import { assertLiveProviderAllowed } from "./provider-policy.js";
import type { SecretStore } from "./secret-store.js";
import { MessagesDecoder, ResponsesDecoder, protocolRequest } from "./protocol-codecs.js";
import { responseFrames } from "./provider-http.js";

/** Native wire protocols; only validated tool requests reach the existing application harness. */
export class ProtocolModelClient implements ContinuableModelClient {
  constructor(private readonly connection: ApiConnection, private readonly secrets: SecretStore, private readonly fetcher: FetchLike, private readonly environment: NodeJS.ProcessEnv, private readonly timeoutMs = 150_000) {}
  get identity() { return { provider: this.connection.id, model: this.connection.model, connection: this.connection.baseUrl }; }
  get capabilities() { return { ...adapterCapabilities(this.connection.tools, "configurable"), contextWindowTokens: this.connection.contextWindow, maxOutputTokens: this.connection.maxOutputTokens, inputModalities: this.connection.images ? ["text", "image"] as const : ["text"] as const }; }
  async prepare(signal: AbortSignal): Promise<void> {
    assertLiveProviderAllowed(this.environment);
    let configured: boolean;
    try { configured = Boolean(await abortable(() => this.secrets.get(`keychain:zhixing/${this.connection.id}`), signal)); }
    catch { signal.throwIfAborted(); throw new Error("secret_store_unavailable"); }
    if (!configured) throw new Error("provider_unavailable");
    signal.throwIfAborted();
  }
  stream(prompt: string, signal: AbortSignal, options?: ModelRequestOptions): AsyncIterable<ModelEvent> { return this.request(prompt, signal, options); }
  continue(prompt: string, _results: readonly ToolResultMessage[], signal: AbortSignal, options?: ModelRequestOptions): AsyncIterable<ModelEvent> {
    if (!options?.history?.length) throw new Error("provider_continuation_context_required");
    return this.request(prompt, signal, options);
  }
  private async *request(prompt: string, parent: AbortSignal, options?: ModelRequestOptions): AsyncGenerator<ModelEvent> {
    assertLiveProviderAllowed(this.environment); parent.throwIfAborted();
    if (options?.messages?.some(message => message.images?.length) && !this.connection.images) throw new Error("image_model_required");
    if (options?.tools?.length && !this.connection.tools) throw new Error("provider_tools_unsupported");
    const started = Date.now(), timeout = AbortSignal.timeout(this.timeoutMs), signal = AbortSignal.any([parent, timeout]);
    const anthropic = this.connection.protocol === "anthropic-messages";
    const decoder = anthropic ? new MessagesDecoder(this.connection) : new ResponsesDecoder(this.connection);
    let reported = false;
    try {
      const maxOutput = Math.min(outputTokenLimit(options?.maxOutputTokens), this.connection.maxOutputTokens);
      const body = protocolRequest(this.connection, prompt, options, maxOutput);
      const key = await abortable(() => this.secrets.get(`keychain:zhixing/${this.connection.id}`), signal);
      if (!key) throw new Error("provider_unavailable");
      const requested = Date.now(); let firstEventMs: number | undefined, firstTextMs: number | undefined, textSize = 0;
      const response = await abortable(() => this.fetcher(`${this.connection.baseUrl}/${anthropic ? "messages" : "responses"}`, {
        method: "POST", redirect: "error", signal, headers: { "content-type": "application/json", ...(anthropic ? { "x-api-key": key, "anthropic-version": "2023-06-01" } : { authorization: `Bearer ${key}` }) }, body: JSON.stringify(body),
      }), signal);
      if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new Error(`provider_unavailable: HTTP ${response.status}`); }
      for await (const frame of responseFrames(response, signal)) {
        firstEventMs ??= Date.now() - requested;
        for (const text of decoder.consume(frame)) {
          firstTextMs ??= Date.now() - requested; textSize += text.length;
          if (textSize > 64_000) throw new Error("provider_output_limit");
          if (text) yield { type: "text_delta", text };
        }
        if (decoder.complete) break;
      }
      signal.throwIfAborted();
      const result = decoder.finish();
      if (!textSize && !result.events.length) throw new Error("provider_incomplete");
      yield* result.events;
      yield { type: "provider_state", result: { connectionId: this.connection.id, model: this.connection.model, protocol: this.connection.protocol, content: result.state } };
      if (decoder.usage) { reported = true; yield { type: "usage", usage: decoder.usage }; }
      yield { type: "timing", timing: { transport: "sse", startupMs: requested - started, selectionMs: 0, totalMs: Date.now() - started, requestMs: Date.now() - requested, firstEventMs, firstTextMs, processTailMs: 0, outputTokenLimit: maxOutput } };
      yield { type: "done" };
    } catch (error) {
      if (decoder.usage && !reported) yield { type: "usage", usage: decoder.usage };
      if (parent.aborted) throw new DOMException("cancelled", "AbortError");
      if (timeout.aborted) throw new Error("provider_timeout");
      if (error instanceof Error && /^(provider_(protocol_error|incomplete|output_limit|model_mismatch|continuation_context_required|unavailable)|secret_store_unavailable|invalid_secret_reference)(: HTTP [1-5]\d{2})?$/.test(error.message)) throw error;
      throw new Error("provider_unavailable");
    }
  }
}
