import { spawn } from "node:child_process";
import type { ModelClient, ModelEvent } from "./model.js";
import { assertLiveProviderAllowed } from "./provider-policy.js";

export interface CodexCommandResult { readonly code: number; readonly stdout: string; readonly stderr: string; }
export type CodexCommandRunner = (args: readonly string[], signal: AbortSignal) => Promise<CodexCommandResult>;

/** Calls an already authenticated official Codex CLI without reading any credential material. */
export class CodexCliClient implements ModelClient {
  constructor(private readonly runner: CodexCommandRunner = runOfficialCodex, private readonly environment: NodeJS.ProcessEnv = process.env, private readonly timeoutMs = 30_000) {}

  async *stream(prompt: string, signal: AbortSignal): AsyncIterable<ModelEvent> {
    assertLiveProviderAllowed(this.environment);
    if (signal.aborted) throw new DOMException("cancelled", "AbortError");
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const invocationSignal = AbortSignal.any([signal, timeout]);
    // Read-only, ephemeral mode prevents the provider process from changing the study workspace.
    let result: CodexCommandResult;
    try { result = await this.runner(["exec", "--sandbox", "read-only", "--ephemeral", "--skip-git-repo-check", "--ignore-rules", "--color", "never", prompt], invocationSignal); }
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

async function runOfficialCodex(args: readonly string[], signal: AbortSignal): Promise<CodexCommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout = `${stdout}${chunk}`.slice(0, 256 * 1024); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = `${stderr}${chunk}`.slice(0, 64 * 1024); });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
    signal.addEventListener("abort", () => child.kill("SIGTERM"), { once: true });
  });
}
