import { StringDecoder } from "node:string_decoder";
import { z } from "zod";
import { PiCodexClient, runPiProcess, type PiProcessRunner } from "./pi-client.js";
import { assertLiveProviderAllowed } from "./provider-policy.js";
import type { ContinuableModelClient, ModelEvent, ModelRequestOptions, ToolResultMessage } from "./model.js";

const eventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text_delta"), text: z.string().max(64_000) }).strict(),
  z.object({ type: z.literal("tool_call"), tool: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), callId: z.string().min(1).max(200), input: z.unknown() }).strict(),
  z.object({ type: z.literal("provider_state"), result: z.unknown() }).strict(),
  z.object({ type: z.literal("done") }).strict(),
  z.object({ type: z.literal("usage"), usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), cacheReadTokens: z.number().int().nonnegative().optional(), reasoningTokens: z.number().int().nonnegative().optional(), model: z.string().max(128).optional(), startupMs: z.number().nonnegative().optional() }).strict() }).strict(),
  z.object({ type: z.literal("error"), code: z.enum(["pi_login_required", "provider_incomplete", "provider_model_mismatch", "provider_output_limit", "provider_unavailable", "live_provider_disabled"]) }).strict(),
]);
export interface PiApplicationOptions { projectDir: string; executable: string; worker: string; sdk: string; runner?: PiProcessRunner; environment?: NodeJS.ProcessEnv; timeoutMs?: number; }

/** One provider turn per isolated process. The SDK generates calls; only our ToolHarness executes them. */
export class PiApplicationClient extends PiCodexClient implements ContinuableModelClient {
  constructor(private readonly bridge: PiApplicationOptions) { super(bridge); }
  async *continue(prompt: string, _results: readonly ToolResultMessage[], signal: AbortSignal, options?: ModelRequestOptions): AsyncIterable<ModelEvent> {
    if (!options?.history?.length) throw new Error("provider_continuation_context_required");
    yield* this.stream(prompt, signal, options);
  }
  override async *stream(prompt: string, parent: AbortSignal, options?: ModelRequestOptions): AsyncIterable<ModelEvent> {
    const environment = this.bridge.environment ?? process.env;
    assertLiveProviderAllowed(environment); parent.throwIfAborted();
    const timeout = AbortSignal.timeout(this.bridge.timeoutMs ?? 150_000);
    const signal = AbortSignal.any([parent, timeout]);
    const decoder = new StringDecoder("utf8");
    let pending = ""; let bytes = 0; let complete = false; let exited = false;
    const accept = (line: string): ModelEvent | undefined => {
      if (!line.trim()) return;
      if (complete) throw new Error("provider_protocol_error");
      let event: z.infer<typeof eventSchema>;
      try { event = eventSchema.parse(JSON.parse(line)); } catch { throw new Error("provider_protocol_error"); }
      if (event.type === "error") throw new Error(event.code);
      if (event.type === "done") { complete = true; return; }
      return event;
    };
    try {
      const selection = await this.selection(); signal.throwIfAborted();
      if (options?.reasoning === "quick") selection.thinking = "low";
      if (options?.reasoning === "deep") selection.thinking = "high";
      const input = JSON.stringify({ version: 1, selection, prompt, options });
      if (input.length > 300_000) throw new Error("model_input_limit");
      for await (const event of (this.bridge.runner ?? runPiProcess)({ command: this.bridge.executable, args: [this.bridge.worker, this.bridge.sdk], cwd: this.bridge.projectDir, input, environment: { ...environment, PI_TELEMETRY: "0", PI_OFFLINE: "1", PI_SKIP_VERSION_CHECK: "1", ELECTRON_RUN_AS_NODE: "1" } }, signal)) {
        signal.throwIfAborted();
        if (exited) throw new Error("provider_protocol_error");
        if (event.type === "exit") {
          if (event.code !== 0) throw new Error("provider_unavailable");
          exited = true; pending += decoder.end();
          const parsed = accept(pending); if (parsed) yield parsed; pending = ""; continue;
        }
        bytes += event.data.length; if (bytes > 4 * 1024 * 1024) throw new Error("provider_output_limit");
        pending += decoder.write(event.data);
        for (;;) {
          const newline = pending.indexOf("\n"); if (newline < 0) break;
          const parsed = accept(pending.slice(0, newline)); pending = pending.slice(newline + 1); if (parsed) yield parsed;
        }
        if (pending.length > 512_000) throw new Error("provider_output_limit");
      }
      if (!complete || !exited) throw new Error("provider_incomplete");
      yield { type: "done" };
    } catch (error) {
      if (parent.aborted) throw new DOMException("cancelled", "AbortError");
      if (timeout.aborted) throw new Error("provider_timeout");
      throw error;
    }
  }
}
