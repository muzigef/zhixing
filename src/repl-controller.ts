export interface ReplSnapshot { running: boolean; queued: number; }
interface ReplHooks {
  execute: (text: string) => Promise<void>;
  interrupt: () => Promise<unknown>;
  canSteer?: () => boolean;
  status?: (state: ReplSnapshot) => void;
  notice?: (text: string) => void;
  error?: (error: unknown) => void;
  idle?: () => void;
}

/** Keeps input responsive while serializing all state-changing actions. */
export class ReplController {
  private queue: string[] = [];
  private running = false;
  private waiters: Array<() => void> = [];
  constructor(private readonly hooks: ReplHooks) {}
  snapshot(): ReplSnapshot { return { running: this.running, queued: this.queue.length }; }
  submit(input: string): void {
    const text = input.trim();
    if (!text) return;
    if (text.length > 8_000) { this.hooks.notice?.("消息过长，请分段发送（每条最多 8,000 字符）。"); return; }
    if (["/stop", "停止", "停一下", "暂停回答"].includes(text)) { void this.interrupt(); return; }
    if (this.running && ["/status", "当前状态", "/queue"].includes(text)) { this.hooks.status?.(this.snapshot()); return; }
    if (text === "/queue clear") { this.queue.length = 0; this.hooks.notice?.("已撤回排队消息。"); return; }
    if (this.queue.length >= 16) { this.hooks.notice?.("队列已满，请等待当前回答或用 /queue clear 撤回排队消息。"); return; }
    const steering = /^\/steer\s+([\s\S]+)$/.exec(text)?.[1] ?? /^(?:等等|等一下|不对|停一下)[，,:：]\s*([\s\S]+)$/.exec(text)?.[1];
    if (this.running && steering && this.hooks.canSteer?.()) {
      this.queue.unshift(steering); this.hooks.notice?.("已收到调整，停止当前回答后按新要求继续。");
      void this.interrupt(false);
    } else {
      this.queue.push(steering ?? text);
      if (this.running) this.hooks.notice?.(`已排队 ${this.queue.length} 条；可继续输入，或停止当前回答。`);
    }
    void this.process();
  }
  async interrupt(notify = true): Promise<void> {
    try { await this.hooks.interrupt(); if (notify && !this.running) this.hooks.notice?.("当前没有正在生成的回答。"); }
    catch (error) { this.hooks.error?.(error); }
  }
  drain(): Promise<void> { return this.running ? new Promise((resolve) => this.waiters.push(resolve)) : Promise.resolve(); }
  private async process(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const text = this.queue.shift()!;
        try { await this.hooks.execute(text); } catch (error) { this.hooks.error?.(error); }
      }
    } finally {
      this.running = false;
      this.waiters.splice(0).forEach((resolve) => resolve());
      this.hooks.idle?.();
    }
  }
}

/** Explicit paste mode and portable backslash-newline compose one bounded prompt. */
export class PromptAssembler {
  private lines: string[] = [];
  private paste = false;
  accept(line: string): { kind: "message"; text: string } | { kind: "collecting"; hint: string } {
    if (line === "/cancel-input") { this.cancel(); return { kind: "collecting", hint: "已取消未发送的输入。" }; }
    if (!this.lines.length && line === "/paste") { this.paste = true; return { kind: "collecting", hint: "粘贴多行内容，单独输入 /send 发送；/cancel-input 取消。" }; }
    if (this.paste && line === "/send") { const text = this.lines.join("\n"); this.cancel(); return { kind: "message", text }; }
    const continued = !this.paste && line.endsWith("\\");
    this.lines.push(continued ? line.slice(0, -1) : line);
    if (this.lines.join("\n").length > 8_000) { this.cancel(); return { kind: "collecting", hint: "输入超过 8,000 字符，已取消本次输入；请分段粘贴。" }; }
    if (this.paste || continued) return { kind: "collecting", hint: "" };
    const text = this.lines.join("\n"); this.cancel(); return { kind: "message", text };
  }
  cancel(): void { this.lines = []; this.paste = false; }
}
