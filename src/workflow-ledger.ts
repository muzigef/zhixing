import crypto from "node:crypto";
import type { TopicId } from "./contracts.js";
import { ZhixingDatabase } from "./database.js";

export type WorkflowStatus = "running" | "completed" | "failed" | "cancelled";
export interface WorkflowRunSummary { readonly runId: string; readonly actionId: string; readonly status: WorkflowStatus; readonly startedAt: string; readonly finishedAt: string | null; readonly errorCode: string | null; }

/** Durable, privacy-safe workflow state. Command text is hashed, never stored. */
export class WorkflowLedger {
  constructor(private readonly database: ZhixingDatabase) {}
  begin(runId: string, topicId: TopicId, actionId: string, command: string): void {
    // A workflow run must remain independently durable even when a learner
    // deliberately repeats the same command.  The current schema enforces a
    // unique key per topic, so bind that key to the run rather than treating a
    // command fingerprint as an implicit, permanent deduplication request.
    // Explicit client idempotency keys can be added at the API boundary later.
    const key = crypto.createHash("sha256").update(`${topicId}:${actionId}:${command}:${runId}`).digest("hex");
    this.database.db.prepare("INSERT INTO workflow_runs(run_id, topic_id, action_id, idempotency_key, status, started_at) VALUES (?, ?, ?, ?, 'running', ?)").run(runId, topicId, actionId, key, new Date().toISOString());
  }
  step(runId: string, stepId: string, status: "started" | "finished" | "failed", detail?: string): void {
    this.database.db.prepare("INSERT OR REPLACE INTO workflow_steps(run_id, step_id, status, at, detail) VALUES (?, ?, ?, ?, ?)").run(runId, stepId, status, new Date().toISOString(), detail?.slice(0, 240) ?? null);
  }
  finish(runId: string, status: Exclude<WorkflowStatus, "running">, errorCode?: string): void {
    this.database.db.prepare("UPDATE workflow_runs SET status = ?, finished_at = ?, error_code = ? WHERE run_id = ?").run(status, new Date().toISOString(), errorCode?.slice(0, 120) ?? null, runId);
  }
  recoverable(topicId: TopicId): Array<{ runId: string; actionId: string; stateVersion: number }> {
    return this.database.db.prepare("SELECT run_id AS runId, action_id AS actionId, state_version AS stateVersion FROM workflow_runs WHERE topic_id = ? AND status = 'running' ORDER BY started_at").all(topicId) as Array<{ runId: string; actionId: string; stateVersion: number }>;
  }
  recent(topicId: TopicId, limit = 5): WorkflowRunSummary[] {
    const bounded = Math.min(Math.max(limit, 1), 20);
    return this.database.db.prepare("SELECT run_id AS runId, action_id AS actionId, status, started_at AS startedAt, finished_at AS finishedAt, error_code AS errorCode FROM workflow_runs WHERE topic_id = ? ORDER BY started_at DESC LIMIT ?").all(topicId, bounded) as WorkflowRunSummary[];
  }
  /**
   * A CLI process cannot safely replay arbitrary writes after a crash. Mark
   * stale runs as interrupted so the next user request is a fresh, audited
   * retry rather than an invisible duplicate side effect.
   */
  reconcileInterrupted(): number {
    return this.database.db.prepare("UPDATE workflow_runs SET status = 'failed', finished_at = ?, error_code = 'process_interrupted' WHERE status = 'running'").run(new Date().toISOString()).changes;
  }
}
