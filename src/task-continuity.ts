import { z } from "zod/v4";
import type { ZhixingDatabase } from "./database.js";
import { AgentExecutionStore, type ExecutionCheckpoint, type ExecutionIdentity } from "./agent-execution-store.js";
import { TaskExecutionStore } from "./task-execution.js";

export const recoveryReportSchema = z.object({ outcome: z.enum(["reported_success", "reported_not_executed", "abandoned"]), note: z.string().trim().min(1).max(2000) }).strict();
export type RecoveryReport = z.infer<typeof recoveryReportSchema>;

function unknownCall(checkpoint: ExecutionCheckpoint | undefined) {
  const pending = checkpoint?.pending;
  if (!pending || pending.phase !== "executing" || pending.executingUntil && pending.executingUntil !== pending.next + 1) return undefined;
  const call = pending.events.filter(event => event.type === "tool_call")[pending.next];
  return call?.tool?.startsWith("mcp_") && call.callId ? { callId: call.callId, tool: call.tool, input: call.input } : undefined;
}

/** User decisions and external verification are separate sources of recovery observations. */
export class TaskContinuity {
  constructor(private readonly database: ZhixingDatabase) {}
  inspect(identity: ExecutionIdentity) {
    const execution = new AgentExecutionStore(this.database, identity); const checkpoint = execution.read();
    if (!checkpoint) throw new Error("task_not_found");
    const tasks = new TaskExecutionStore(this.database);
    let task: ReturnType<TaskExecutionStore["snapshot"]> | null = null;
    try { task = tasks.snapshot(identity.taskId, identity.topicId); } catch (error) { if (!(error instanceof Error) || error.message !== "task_not_found") throw error; }
    return { taskId: identity.taskId, status: checkpoint.status, task, revisions: task ? tasks.revisions(identity.taskId, identity.topicId) : [], recovery: unknownCall(checkpoint) ?? null, usage: execution.usage(), receipts: [...checkpoint.history, ...(checkpoint.pending ? [checkpoint.pending] : [])].flatMap(turn => turn.toolResults).filter(item => (item.result as { recovery?: boolean } | null)?.recovery === true) };
  }
  report(identity: ExecutionIdentity, callId: string, raw: RecoveryReport): void {
    const report = recoveryReportSchema.parse(raw);
    this.resolve(identity, callId, { ok: false, recovery: true, source: "user_report", verified: false, ...report, errorCode: "external_result_unverified", instruction: "这是用户自报，不能称为服务核验或原工具成功。后续写入需要重新逐项授权。" });
  }
  /** Only trusted verification adapters call this method; never accept these fields from IPC/model input. */
  resolve(identity: ExecutionIdentity, callId: string, observation: Record<string, unknown>): void {
    const execution = new AgentExecutionStore(this.database, identity); const release = execution.claim();
    try {
      const checkpoint = execution.read(); if (!checkpoint) throw new Error("task_not_found");
      const existing = [...checkpoint.history, ...(checkpoint.pending ? [checkpoint.pending] : [])].flatMap(turn => turn.toolResults).find(item => item.callId === callId);
      if (existing) { if (JSON.stringify(existing.result) === JSON.stringify(observation)) return; throw new Error("recovery_conflict"); }
      const call = unknownCall(checkpoint);
      if (!call || call.callId !== callId) throw new Error("recovery_conflict");
      const pending = checkpoint.pending!;
      checkpoint.pending = { ...pending, toolResults: [...pending.toolResults, { tool: call.tool, callId, dispatch: observation.verified === true ? undefined : "unknown", result: observation }], next: pending.next + 1, phase: "ready", executingUntil: undefined };
      checkpoint.status = "interrupted";
      execution.save(checkpoint, observation.verified === true ? "external_result_verified" : "external_result_reported", callId);
    } finally { release(); }
  }
}
export type TaskInspection = ReturnType<TaskContinuity["inspect"]>;
