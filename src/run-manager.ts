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
    try {
      await lifecycle.start();
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
      const cancelled = controller.signal.aborted || error instanceof Error && error.name === "AbortError";
      const code = cancelled ? "cancelled" : errorCode(error);
      this.recordLedger(() => this.ledger?.step(lifecycle.runId, "command", "failed"));
      this.recordLedger(() => this.ledger?.finish(lifecycle.runId, cancelled ? "cancelled" : "failed", code));
      try {
        await lifecycle.tool(command, "failed");
        if (cancelled) await lifecycle.cancel();
        else await lifecycle.fail(code);
      } catch { /* Preserve the original failure if audit storage itself is unavailable. */ }
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

/** Persist only recognized codes; provider exception details may contain user material. */
function errorCode(error: unknown): string {
  const code = error instanceof Error ? error.message.split(":", 1)[0] : undefined;
  const allowed = new Set(["provider_unavailable", "provider_timeout", "provider_incomplete", "provider_output_limit", "provider_protocol_error", "provider_continuation_unsupported", "provider_tools_unsupported", "live_provider_disabled", "external_content_confirmation_required", "tool_failed", "tool_timeout", "tool_cancelled", "tool_input_invalid", "tool_not_allowed", "tool_policy_denied", "cross_topic_denied", "max_turns", "max_tool_calls", "repeated_tool_call", "untrusted_tool_result", "model_output_limit", "model_event_limit", "model_input_limit", "invocation_timeout", "practice_round_limit"]);
  return code && allowed.has(code) ? code : "operation_failed";
}
