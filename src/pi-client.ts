import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";
import type { ModelClient, ModelEvent } from "./model.js";
import { assertLiveProviderAllowed } from "./provider-policy.js";

const projectDirectory = fileURLToPath(new URL("..", import.meta.url));
const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
export interface PiModelSelection { provider: "openai-codex"; model: string; thinking: string; }
export interface PiProcessRequest { command: string; args: string[]; cwd: string; input: string; environment: NodeJS.ProcessEnv; }
export type PiProcessEvent = { type: "stdout"; data: Buffer } | { type: "exit"; code: number };
export type PiProcessRunner = (request: PiProcessRequest, signal: AbortSignal) => AsyncIterable<PiProcessEvent>;
interface PiOptions { projectDir?: string; environment?: NodeJS.ProcessEnv; runner?: PiProcessRunner; timeoutMs?: number; }

/** Read model preferences only. Pi itself owns authentication and token refresh. */
export async function readPiModelSelection(projectDir = projectDirectory, environment: NodeJS.ProcessEnv = process.env): Promise<PiModelSelection> {
  const agentDir = environment.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
  const values: Record<string, unknown> = {};
  for (const file of [path.join(agentDir, "settings.json"), path.join(projectDir, ".pi", "settings.json")]) {
    try {
      if ((await fs.stat(file)).size > 256_000) throw new Error("pi_configuration_required");
      const settings: unknown = JSON.parse(await fs.readFile(file, "utf8"));
      if (!isObject(settings)) throw new Error("pi_configuration_required");
      for (const key of ["defaultProvider", "defaultModel", "defaultThinkingLevel"]) if (settings[key] !== undefined) values[key] = settings[key];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("pi_configuration_required");
    }
  }
  if (values.defaultProvider !== "openai-codex" || typeof values.defaultModel !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(values.defaultModel)) throw new Error("pi_configuration_required");
  const thinking = values.defaultThinkingLevel ?? "medium";
  if (typeof thinking !== "string" || !thinkingLevels.includes(thinking)) throw new Error("pi_configuration_required");
  return { provider: "openai-codex", model: values.defaultModel, thinking };
}

/** Text-only adapter through the reviewed Pi launcher, using Pi's configured Codex model. */
export class PiCodexClient implements ModelClient {
  private readonly environment: NodeJS.ProcessEnv;
  private readonly projectDir: string;
  private readonly runner: PiProcessRunner;
  private readonly timeoutMs: number;
  constructor(options: PiOptions = {}) {
    this.environment = options.environment ?? process.env;
    this.projectDir = options.projectDir ?? projectDirectory;
    this.runner = options.runner ?? runPiProcess;
    this.timeoutMs = options.timeoutMs ?? 150_000;
  }
  selection(): Promise<PiModelSelection> { return readPiModelSelection(this.projectDir, this.environment); }
  async *stream(prompt: string, parent: AbortSignal): AsyncIterable<ModelEvent> {
    assertLiveProviderAllowed(this.environment); parent.throwIfAborted();
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const signal = AbortSignal.any([parent, timeout]);
    try {
      const selection = await this.selection(); signal.throwIfAborted();
      const request: PiProcessRequest = {
        command: "bash", cwd: this.projectDir,
        args: [path.join(this.projectDir, "scripts", "pi-safe.sh"), "--print", "--mode", "json", "--no-session", "--offline", "--no-tools", "--tools", "", "--no-skills", "--no-prompt-templates", "--no-themes", "--provider", selection.provider, "--model", selection.model, "--thinking", selection.thinking, "--system-prompt", "你是知行的学习对话模型。根据提供的上下文直接回答本轮请求，遵循用户的语言、篇幅和格式要求。此调用只生成回答，不执行项目开发、文件操作或命令，不声称已完成未执行的动作。"],
        input: `请处理以下知行对话请求：\n\n${prompt}`,
        environment: { ...this.environment, PI_TELEMETRY: "0", PI_SKIP_VERSION_CHECK: "1", PI_OFFLINE: "1" },
      };
      const parser = new PiJsonStream(selection);
      const decoder = new StringDecoder("utf8");
      let pending = ""; let bytes = 0; let exited = false;
      for await (const event of this.runner(request, signal)) {
        signal.throwIfAborted();
        if (exited) throw new Error("provider_protocol_error");
        if (event.type === "exit") {
          if (event.code !== 0) throw new Error("provider_unavailable: Pi 调用失败，请在 Pi 中检查模型和登录状态。");
          exited = true; pending += decoder.end();
          if (pending.trim()) yield* parser.accept(pending);
          pending = ""; continue;
        }
        bytes += event.data.length;
        if (bytes > 64 * 1024 * 1024) throw new Error("provider_output_limit");
        pending += decoder.write(event.data);
        for (;;) {
          const newline = pending.indexOf("\n");
          if (newline < 0) break;
          const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
          if (Buffer.byteLength(line) > 1024 * 1024) throw new Error("provider_output_limit");
          if (line.trim()) yield* parser.accept(line);
        }
        if (Buffer.byteLength(pending) > 1024 * 1024) throw new Error("provider_output_limit");
      }
      signal.throwIfAborted();
      if (!exited || !parser.complete) throw new Error("provider_incomplete");
      yield { type: "done" };
    } catch (error) {
      if (parent.aborted) throw new DOMException("cancelled", "AbortError");
      if (timeout.aborted) throw new Error("provider_timeout: Pi 在限定时间内未完成回答。");
      throw error;
    }
  }
}

class PiJsonStream {
  private streamed = false;
  private messageComplete = false;
  private agentComplete = false;
  private textSize = 0;
  private eventCount = 0;
  constructor(private readonly selection: PiModelSelection) {}
  get complete(): boolean { return this.messageComplete && this.agentComplete; }
  *accept(line: string): Iterable<ModelEvent> {
    if (++this.eventCount > 20_000) throw new Error("provider_output_limit");
    let event: unknown;
    try { event = JSON.parse(line); } catch { throw new Error("provider_protocol_error"); }
    if (!isObject(event) || typeof event.type !== "string") throw new Error("provider_protocol_error");
    if (event.type.startsWith("tool_execution_")) throw new Error("provider_tools_unsupported");
    if (event.type === "message_update" && isObject(event.assistantMessageEvent)) {
      const update = event.assistantMessageEvent;
      if (String(update.type).startsWith("toolcall_")) throw new Error("provider_tools_unsupported");
      if (update.type === "text_delta") {
        if (this.messageComplete || typeof update.delta !== "string") throw new Error("provider_protocol_error");
        this.streamed = true; yield* this.text(update.delta);
      }
    }
    if (event.type === "message_end" && isObject(event.message) && event.message.role === "assistant") {
      const message = event.message;
      if (message.provider !== this.selection.provider || message.model !== this.selection.model) throw new Error("provider_model_mismatch");
      if (message.stopReason === "error") {
        if (["Failed to extract accountId from token", "No API key for provider: openai-codex"].includes(String(message.errorMessage ?? ""))) throw new Error("pi_login_required");
        throw new Error("provider_unavailable: Pi 模型调用失败，请在 Pi 中检查连接或登录状态。");
      }
      if (message.stopReason === "toolUse") throw new Error("provider_tools_unsupported");
      if (message.stopReason !== "stop") throw new Error("provider_incomplete");
      if (!Array.isArray(message.content)) throw new Error("provider_protocol_error");
      if (!this.streamed) {
        for (const part of message.content) if (isObject(part) && part.type === "text" && typeof part.text === "string") yield* this.text(part.text);
      }
      this.messageComplete = true;
    }
    if (event.type === "agent_end") this.agentComplete = true;
  }
  private *text(text: string): Iterable<ModelEvent> {
    this.textSize += text.length;
    if (this.textSize > 64_000) throw new Error("provider_output_limit");
    if (text) yield { type: "text_delta", text };
  }
}
function isObject(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }

/** Spawn without a shell; prompts go through stdin, never argv or an @file argument. */
export async function* runPiProcess(request: PiProcessRequest, signal: AbortSignal): AsyncIterable<PiProcessEvent> {
  signal.throwIfAborted();
  const child = spawn(request.command, request.args, { cwd: request.cwd, env: request.environment, shell: false, stdio: ["pipe", "pipe", "pipe"] });
  let closed = false; let failed = false; let forceKill: ReturnType<typeof setTimeout> | undefined;
  const completion = new Promise<number>((resolve) => {
    child.once("error", () => { failed = true; });
    child.once("close", (code) => { closed = true; if (forceKill) clearTimeout(forceKill); resolve(code ?? 1); });
  });
  const stop = () => {
    if (closed) return;
    child.kill("SIGTERM");
    forceKill ??= setTimeout(() => child.kill("SIGKILL"), 1_000);
    child.stdout.destroy();
  };
  signal.addEventListener("abort", stop, { once: true });
  // Pi can include network details in stderr. Drain it without retaining or exposing it.
  child.stderr.resume();
  child.stdin.on("error", () => { failed = true; });
  child.stdin.end(request.input);
  try {
    for await (const chunk of child.stdout) { signal.throwIfAborted(); yield { type: "stdout", data: Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk) }; }
    const code = await completion; signal.throwIfAborted();
    if (failed) throw new Error("provider_unavailable: 无法启动 Pi，请检查 Pi 安装与登录状态。");
    yield { type: "exit", code };
  } finally {
    signal.removeEventListener("abort", stop);
    stop(); await completion;
    if (forceKill) clearTimeout(forceKill);
  }
}
