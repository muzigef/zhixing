import type { ModelClient, ModelEvent } from "./model.js";
import { assertLiveProviderAllowed } from "./provider-policy.js";

export interface CodexCommandResult { readonly code: number; readonly stdout: string; readonly stderr: string; }
export type CodexCommandRunner = (args: readonly string[], signal: AbortSignal) => Promise<CodexCommandResult>;

/** @deprecated Historical adapter kept for compatibility tests. Product routes use NativeAgentExecutor. */
export class CodexCliClient implements ModelClient {
  constructor(private readonly runner?: CodexCommandRunner, private readonly environment: NodeJS.ProcessEnv = process.env, private readonly timeoutMs = 60_000) {}

  async *stream(prompt: string, signal: AbortSignal): AsyncIterable<ModelEvent> {
    assertLiveProviderAllowed(this.environment);
    if (signal.aborted) throw new DOMException("cancelled", "AbortError");
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const invocationSignal = AbortSignal.any([signal, timeout]);
    if (!this.runner) throw new Error("legacy_codex_runtime_retired");
    let result: CodexCommandResult;
    try { result = await this.runner(["exec", "--sandbox", "read-only", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--color", "never", prompt], invocationSignal); }
    catch (error) {
      if (timeout.aborted) throw new Error("provider_timeout");
      throw error;
    }
    if (timeout.aborted) throw new Error("provider_timeout");
    if (signal.aborted) throw new DOMException("cancelled", "AbortError");
    if (result.code !== 0) throw new Error(`provider_unavailable: ${result.stderr.slice(0, 240) || `exit ${result.code}`}`);
    yield { type: "text_delta", text: result.stdout.trim() };
    yield { type: "done" };
  }
}

/** Extract only assistant text from `codex exec --json`; ignore lifecycle/tool events. */
export function codexJsonText(line: string, receivedDelta = false): string | undefined {
  try {
    const event = JSON.parse(line) as { type?: string; delta?: string; text?: string; item?: { type?: string; text?: string; content?: Array<{ type?: string; text?: string }> } };
    if (/delta/i.test(event.type ?? "") && typeof event.delta === "string") return event.delta;
    const item = event.item;
    if (!receivedDelta && item && /agent.?message/i.test(item.type ?? "")) return item.text ?? (item.content?.map((part) => part.text ?? "").join("") || undefined);
    if (!receivedDelta && /agent.?message/i.test(event.type ?? "") && typeof event.text === "string") return event.text;
  } catch { /* A non-JSON line is not model text in --json mode. */ }
  return undefined;
}
