import { z } from "zod/v4";
import { teamFailureSchema, teamReportSchema } from "./team-quality.js";
import { citationSchema } from "./learning-contracts.js";

export const executionEvidenceSchema = z.object({ id: z.string().length(64), executionId: z.string().uuid(), callId: z.string().max(200), tool: z.string().max(200), inputHash: z.string().length(64), outputHash: z.string().length(64), ok: z.boolean() }).strict();
export type ExecutionEvidence = z.infer<typeof executionEvidenceSchema>;

export const teamPacketSchema = z.object({ question: z.string().max(32_000), history: z.array(z.object({ role: z.enum(["user", "assistant", "observation"]), content: z.string().max(24_000) }).strict()).max(12), truncated: z.boolean(), hash: z.string().length(64) }).strict();
export type TeamPacket = z.infer<typeof teamPacketSchema>;

const key = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/);
export const plannedTaskSchema = z.object({ id: key, member: z.number().int().min(1).max(2), goal: z.string().trim().min(1).max(2000), dependsOn: z.array(key).max(4), acceptance: z.array(z.string().trim().min(1).max(300)).min(1).max(6) }).strict();
export const teamTaskSchema = plannedTaskSchema.omit({ id: true }).extend({
  id: z.string().uuid(), key, status: z.enum(["queued", "running", "completed", "failed", "cancelled", "interrupted", "blocked"]),
  attempts: z.number().int().min(0).max(3), executionId: z.string().uuid().optional(), report: teamReportSchema.optional(), failureCode: teamFailureSchema.optional(),
  durationMs: z.number().nonnegative().optional(),
  kind: z.enum(["work", "followup"]).optional(),
  runs: z.array(z.object({ executionId: z.string().uuid(), status: z.enum(["running", "completed", "failed", "cancelled", "interrupted", "blocked"]), failureCode: teamFailureSchema.optional() }).strict()).max(3).optional(),
  evidence: z.array(executionEvidenceSchema).max(48).optional(),
  citations: z.array(citationSchema).max(24).optional(),
});
export type TeamTask = z.infer<typeof teamTaskSchema>;
export function teamTaskRetryProblem(tasks: readonly TeamTask[] | undefined, id: string): string | undefined {
  const task = tasks?.find(item => item.id === id);
  if (!task || !["failed", "cancelled", "interrupted", "blocked"].includes(task.status) || task.attempts >= 3) return "team_task_not_retryable";
  if (task.dependsOn.some(key => tasks?.find(item => item.key === key)?.status !== "completed")) return "team_task_dependency_incomplete";
  return undefined;
}
