/** Presentation buffering only; authoritative session snapshots always win. */
export class DeltaBatcher {
  private pending = new Map<string, Map<string, string>>();
  private cancel?: () => void;
  constructor(private readonly emit: (session: string, message: string, text: string) => void,
    private readonly schedule: (task: () => void) => () => void = task => { const timer = setTimeout(task, 32); return () => clearTimeout(timer); }) {}
  add(session: string, message: string, text: string): void {
    let items = this.pending.get(session); if (!items) { items = new Map(); this.pending.set(session, items); }
    items.set(message, (items.get(message) ?? "") + text);
    if (items.get(message)!.length >= 64_000) this.flush(session);
    if (this.pending.size && !this.cancel) this.cancel = this.schedule(() => { this.cancel = undefined; this.flush(); });
  }
  discard(session: string): void { this.pending.delete(session); this.clearIfEmpty(); }
  flush(session?: string): void {
    for (const [id, messages] of this.pending) {
      if (session && id !== session) continue;
      this.pending.delete(id);
      for (const [message, text] of messages) this.emit(id, message, text);
    }
    this.clearIfEmpty();
  }
  dispose(): void { this.pending.clear(); this.clearIfEmpty(); }
  private clearIfEmpty(): void { if (!this.pending.size) { this.cancel?.(); this.cancel = undefined; } }
}
