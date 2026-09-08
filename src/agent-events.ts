import type { AgentEvent } from "./agent-session-contracts.js";
/** Transport-only batching. Flush before any non-delta event to preserve canonical order. */
export class AgentEventCoalescer {
  private pending?: Extract<AgentEvent, { type: "delta" }>;
  private timer?: ReturnType<typeof setTimeout>;
  constructor(private readonly deliver: (event: AgentEvent) => void) {}
  push(event: AgentEvent): void {
    if (event.type !== "delta") { this.flush(); this.deliver(event); return; }
    if (this.pending && (this.pending.sessionId !== event.sessionId || this.pending.messageId !== event.messageId)) this.flush();
    if (this.pending) this.pending.text += event.text; else this.pending = { ...event };
    if (this.pending.text.length >= 32_000) this.flush();
    else if (!this.timer) this.timer = setTimeout(() => this.flush(), 16);
  }
  flush(): void { if (this.timer) clearTimeout(this.timer); this.timer = undefined; const pending = this.pending; this.pending = undefined; if (pending) this.deliver(pending); }
  dispose(): void { this.flush(); }
}
