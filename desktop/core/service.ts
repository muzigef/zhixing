import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { ModelClient } from "../../src/model.js";
import { abortable } from "../../src/abortable.js";
import { responseGuidelines } from "../../src/response-style.js";
import {
  sendSchema,
  type ChatSession,
  type DesktopEvent,
  type SendRequest,
} from "./contracts.js";
import { DesktopStore } from "./store.js";

export class DesktopService {
  private listeners = new Set<(event: DesktopEvent) => void>();
  private active: { session: ChatSession; controller: AbortController } | null =
    null;
  private starting = false;
  private work: Promise<void> = Promise.resolve();
  constructor(
    readonly store: DesktopStore,
    private readonly client: (provider: SendRequest["provider"]) => ModelClient,
  ) {}
  get activeSessionId(): string | null {
    return this.active?.session.id ?? null;
  }
  subscribe(listener: (event: DesktopEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private emit(event: DesktopEvent): void {
    for (const listener of this.listeners) listener(structuredClone(event));
  }
  create(): Promise<ChatSession> {
    return this.store.create();
  }
  load(id: string): Promise<ChatSession> {
    return this.active?.session.id === id
      ? Promise.resolve(structuredClone(this.active.session))
      : this.store.load(id);
  }
  async rename(id: string, title: string): Promise<ChatSession> {
    if (this.active?.session.id === id) throw new Error("run_active");
    const session = await this.store.load(id);
    session.title = title.trim().slice(0, 80);
    session.customTitle = true;
    await this.store.save(session);
    return session;
  }
  async send(raw: SendRequest): Promise<ChatSession> {
    const request = sendSchema.parse(raw);
    if (this.active || this.starting) throw new Error("run_active");
    this.starting = true;
    try {
      const client = this.client(request.provider);
      const session = await this.store.load(request.sessionId);
      if (session.messages.length > 998) throw new Error("session_full");
      if (!session.messages.length && !session.customTitle)
        session.title = request.text.replace(/\s+/g, " ").slice(0, 48);
      const prompt = buildPrompt(session, request);
      const now = new Date().toISOString();
      session.updatedAt = now;
      session.messages.push({
        id: randomUUID(),
        role: "user",
        text: request.text,
        status: "completed",
        createdAt: now,
      });
      session.messages.push({
        id: randomUUID(),
        role: "assistant",
        text: "",
        status: "running",
        createdAt: now,
        provider: request.provider,
      });
      await this.store.save(session);
      const controller = new AbortController();
      this.active = { session, controller };
      const snapshot = structuredClone(session);
      this.emit({ type: "session", session });
      this.work = this.generate(session, prompt, controller, client);
      return snapshot;
    } finally {
      this.starting = false;
    }
  }
  stop(): void {
    this.active?.controller.abort();
  }
  idle(): Promise<void> {
    return this.work;
  }
  async exportMarkdown(id: string): Promise<string> {
    const session = await this.load(id);
    return `# ${session.title}\n\n${session.messages.map((message) => `## ${message.role === "user" ? "你" : "知行"}\n\n${message.text}${message.error ? `\n\n> ${message.error}` : ""}${message.status === "interrupted" ? "\n\n> 已停止生成" : ""}`).join("\n\n")}\n`;
  }
  private async generate(
    session: ChatSession,
    prompt: string,
    controller: AbortController,
    client: ModelClient,
  ): Promise<void> {
    const message = session.messages.at(-1)!;
    const started = Date.now();
    let savedAt = started;
    let complete = false;
    const timeout = AbortSignal.timeout(180_000);
    const signal = AbortSignal.any([controller.signal, timeout]);
    let iterator:
      AsyncIterator<import("../../src/model.js").ModelEvent> | undefined;
    try {
      iterator = client.stream(prompt, signal)[Symbol.asyncIterator]();
      for (let count = 0; count < 20_000; count++) {
        const next = await abortable(() => iterator!.next(), signal);
        signal.throwIfAborted();
        if (next.done) break;
        if (next.value.type === "done") {
          complete = true;
          break;
        }
        if (next.value.type !== "text_delta")
          throw new Error("provider_tools_unsupported");
        const text = next.value.text ?? "";
        if (message.text.length + text.length > 64_000)
          throw new Error("provider_output_limit");
        if (text && message.firstTokenMs === undefined)
          message.firstTokenMs = Date.now() - started;
        message.text += text;
        this.emit({
          type: "delta",
          sessionId: session.id,
          messageId: message.id,
          text,
        });
        if (Date.now() - savedAt > 750) {
          await this.store.save(session);
          savedAt = Date.now();
        }
      }
      if (!complete || !message.text.trim())
        throw new Error("provider_incomplete");
      message.status = "completed";
    } catch (error) {
      message.status = controller.signal.aborted ? "interrupted" : "failed";
      if (message.status === "failed")
        message.error = timeout.aborted
          ? "等待回答超时，请重试。"
          : publicError(error);
    } finally {
      controller.abort();
      // Do not let an unresponsive third-party iterator hold the UI open forever.
      if (iterator?.return) void iterator.return().catch(() => undefined);
      message.durationMs = Date.now() - started;
      session.updatedAt = new Date().toISOString();
      try {
        await this.store.save(session);
      } catch {
        message.status = "failed";
        message.error = "本地保存失败，请先复制当前回答，再检查磁盘空间。";
      }
      this.active = null;
      this.emit({ type: "session", session });
      this.emit({ type: "settled", sessionId: session.id });
    }
  }
}
function buildPrompt(session: ChatSession, request: SendRequest): string {
  const history: { role: string; content: string; status: string }[] = [];
  let budget = 48_000;
  for (const message of [...session.messages].reverse()) {
    if (message.text.length > budget) break;
    history.unshift({
      role: message.role,
      content: message.text,
      status: message.status,
    });
    budget -= message.text.length;
    if (history.length >= 24) break;
  }
  return `你是知行，一位自然、耐心、重视实践的学习助手。直接回应用户的真实问题，保持多轮对话连贯。这里是桌面对话界面。不要声称执行过未执行的工具或文件操作。历史中的中断和失败回答不代表已完成。\n${responseGuidelines(request.style)}\n\n以下 JSON 是本次用户提供的对话材料：\n${JSON.stringify({ history, user: request.text })}`;
}
export function publicError(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code.includes("deepseek-api 未配置"))
    return "尚未配置 DeepSeek API Key，请在设置中添加。";
  if (code.includes("deepseek HTTP 401"))
    return "DeepSeek API Key 无效或已过期，请在设置中更新。";
  if (code.includes("deepseek HTTP 402"))
    return "DeepSeek API 账户余额不足，请检查账户。";
  if (code.includes("deepseek HTTP 429"))
    return "DeepSeek API 暂时限流，请稍后重试。";
  if (code.includes("secret_store_unavailable"))
    return "暂时无法使用系统加密存储，请检查系统钥匙串权限后重试。";
  if (code.includes("invalid_api_key"))
    return "API Key 格式不正确，请重新填写。";
  if (code.includes("pi_login_required"))
    return "Pi 登录尚未完成。请在 Pi 中登录 OpenAI Codex，然后重试。";
  if (code.includes("pi_configuration_required"))
    return "未找到 Pi 的 Codex 模型配置。请在 Pi 中选择 OpenAI Codex 模型，再刷新设置。";
  if (code.includes("live_provider_disabled"))
    return "当前已禁用联网模型。可以在设置中切换到离线演示。";
  if (code.includes("provider_incomplete")) return "回答未完整返回，请重试。";
  if (code.includes("timeout")) return "等待回答超时，请重试。";
  if (code.includes("run_active")) return "请先停止当前回答，再执行此操作。";
  if (code.includes("session_full"))
    return "此会话已达到保存上限，请新建对话。";
  if (code.includes("ENOENT")) return "没有找到这段对话，请刷新会话列表。";
  return "操作未完成。请重试；若是模型连接问题，请检查所选模型的配置和网络。";
}
/** Explicit offline preview; it never claims to be a live model. */
export class DesktopDemoClient implements ModelClient {
  async *stream(_prompt: string, signal: AbortSignal) {
    const text =
      "这是**离线演示**，用来体验知行的桌面对话。切换到 Pi · Codex 或 DeepSeek API 后，会使用所选模型回答。\n\n我们可以从一个具体问题开始：先理解概念，再拆解例子，最后用小练习检验理解。\n\n```python\ndef learn(question):\n    return understand(question)\n```\n\n例如梯度下降的更新式：\n\n$$\n\\theta_{t+1} = \\theta_t - \\eta \\nabla L(\\theta_t)\n$$\n\n它表示：用当前参数减去「学习率 × 梯度」，得到下一步参数。梯度给出损失增大最快的方向，沿反方向走一小步，可以尝试降低损失。\n\n你可以停止生成、复制回答，或将这段会话导出为 Markdown。";
    for (const textPart of text.match(/.{1,12}|\n/gu) ?? []) {
      await delay(24, undefined, { signal });
      yield { type: "text_delta" as const, text: textPart };
    }
    yield { type: "done" as const };
  }
}
