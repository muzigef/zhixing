import type { TopicId } from "./contracts.js";
import { AuditLogger } from "./audit.js";
import { RunContext } from "./run-context.js";
import { WorkflowLedger } from "./workflow-ledger.js";

/** Keeps the single foreground CLI run cancellable without retaining user input. */
export class RunManager {
  #active: { controller: AbortController; lifecycle: RunContext } | undefined;

  constructor(private readonly audit: AuditLogger, private readonly ledger?: WorkflowLedger) {}

  async run(topicId: TopicId, command: string, action: (signal: AbortSignal, lifecycle: RunContext) => Promise<string>, actionId = "cli.command"): Promise<string> {
    if (this.#active) throw new Error("run_in_progress");
    const controller = new AbortController();
    const lifecycle = new RunContext(this.audit, topicId, command);
    this.#active = { controller, lifecycle };
    this.recordLedger(() => this.ledger?.begin(lifecycle.runId, topicId, actionId, command));
    await lifecycle.start();
    try {
      if (controller.signal.aborted) throw new DOMException("cancelled", "AbortError");
      await lifecycle.tool(command, "started");
      this.recordLedger(() => this.ledger?.step(lifecycle.runId, "command", "started"));
      const result = await action(controller.signal, lifecycle);
      if (controller.signal.aborted) throw new DOMException("cancelled", "AbortError");
      await lifecycle.tool(command, "finished");
      this.recordLedger(() => this.ledger?.step(lifecycle.runId, "command", "finished"));
      await lifecycle.finish("ok");
      this.recordLedger(() => this.ledger?.finish(lifecycle.runId, "completed"));
      return result;
    } catch (error) {
      await lifecycle.tool(command, "failed");
      this.recordLedger(() => this.ledger?.step(lifecycle.runId, "command", "failed"));
      if (controller.signal.aborted || error instanceof DOMException && error.name === "AbortError") await lifecycle.cancel();
      else await lifecycle.fail(error instanceof Error ? error.message : "unknown_error");
      this.recordLedger(() => this.ledger?.finish(lifecycle.runId, controller.signal.aborted ? "cancelled" : "failed", error instanceof Error ? error.message : "unknown_error"));
      throw error;
    } finally { this.#active = undefined; }
  }

  async cancel(): Promise<boolean> {
    const active = this.#active;
    if (!active) return false;
    active.controller.abort();
    return true;
  }

  /** A database restore intentionally closes the old ledger connection mid-run. */
  private recordLedger(record: () => void): void {
    try { record(); } catch { /* Audit remains authoritative when a storage swap is in progress. */ }
  }
}
