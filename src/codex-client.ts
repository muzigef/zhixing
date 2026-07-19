import { spawn } from "node:child_process";
import os from "node:os";
import type { ModelClient, ModelEvent } from "./model.js";
import { assertLiveProviderAllowed } from "./provider-policy.js";

export interface CodexCommandResult { readonly code: number; readonly stdout: string; readonly stderr: string; }
export type CodexCommandRunner = (args: readonly string[], signal: AbortSignal) => Promise<CodexCommandResult>;

/** Calls an already authenticated official Codex CLI without reading any credential material. */
export class CodexCliClient implements ModelClient {
  constructor(private readonly runner: CodexCommandRunner = runOfficialCodex, private readonly environment: NodeJS.ProcessEnv = process.env, private readonly timeoutMs = 60_000) {}

  async *stream(prompt: string, signal: AbortSignal): AsyncIterable<ModelEvent> {
    assertLiveProviderAllowed(this.environment);
    if (signal.aborted) throw new DOMException("cancelled", "AbortError");
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const invocationSignal = AbortSignal.any([signal, timeout]);
    // Use the same stable, public `codex exec` surface the user runs directly.
    if (this.runner === runOfficialCodex) {
      // Run as a text-only provider, not as a coding session in this repository:
      // this avoids loading project instructions/plugins that can make a tutor turn
      // attempt workspace work before answering.
      yield* streamOfficialCodex(["exec", "--sandbox", "read-only", "--ephemeral", "--skip-git-repo-check", "--ignore-user-config", "--cd", os.tmpdir(), "--color", "never", "--json", prompt], invocationSignal, timeout);
      return;
    }
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

async function* streamOfficialCodex(args: readonly string[], signal: AbortSignal, timeout: AbortSignal): AsyncIterable<ModelEvent> {
  const child = spawn("codex", args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
  const chunks: string[] = [];
  const maxBufferedOutput = 256 * 1024;
  let bufferedOutput = 0;
  let outputLimitExceeded = false;
  let lineBuffer = "";
  let receivedDelta = false;
  const stderr: string[] = [];
  let closed = false;
  let code = 1;
  let spawnError: Error | undefined;
  child.stdout.on("data", (chunk: Buffer) => {
    lineBuffer += chunk.toString("utf8");
    for (;;) {
      const newline = lineBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = lineBuffer.slice(0, newline); lineBuffer = lineBuffer.slice(newline + 1);
      const text = codexJsonText(line, receivedDelta);
      if (text) {
        receivedDelta = true;
        bufferedOutput += Buffer.byteLength(text);
        if (bufferedOutput > maxBufferedOutput) { outputLimitExceeded = true; child.kill("SIGTERM"); return; }
        chunks.push(text);
      }
    }
  });
  child.stderr.on("data", (chunk: Buffer) => { stderr.push(chunk.toString("utf8")); });
  child.once("error", (error) => { spawnError = error; closed = true; });
  child.once("close", (value) => { code = value ?? 1; closed = true; });
  let forceKill: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    child.kill("SIGTERM");
    forceKill = setTimeout(() => child.kill("SIGKILL"), 3_000);
  };
  signal.addEventListener("abort", stop, { once: true });
  try {
    while (!closed || chunks.length) {
      if (timeout.aborted) throw new Error("provider_timeout: Codex 在限定时间内未返回；请检查 Codex CLI 网络连接后重试。");
      if (signal.aborted) throw new DOMException("cancelled", "AbortError");
      if (outputLimitExceeded) throw new Error("provider_output_limit: Codex 输出超过单轮限制");
      const chunk = chunks.shift();
      if (chunk) yield { type: "text_delta", text: chunk };
      else await new Promise((resolve) => setTimeout(resolve, 25));
    }
    // POSIX streams are not required to finish JSONL with a newline.
    const finalText = codexJsonText(lineBuffer, receivedDelta);
    if (Buffer.byteLength(lineBuffer) > maxBufferedOutput) throw new Error("provider_output_limit: Codex 输出超过单轮限制");
    if (finalText) yield { type: "text_delta", text: finalText };
    if (spawnError) throw new Error(`provider_unavailable: ${spawnError.message}`);
    if (code !== 0) throw new Error(`provider_unavailable: ${stderr.join("").trim().slice(0, 240) || "codex CLI failed"}`);
    yield { type: "done" };
  } finally {
    if (forceKill) clearTimeout(forceKill);
    signal.removeEventListener("abort", stop);
    if (!closed) stop();
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
