import { z } from "zod/v4";
import { providerSchema } from "./agent-provider.js";
import { teamFailureSchema, teamReportSchema, teamReviewDecisionSchema } from "./team-quality.js";
import { teamTaskSchema, teamPacketSchema } from "./team-work-contracts.js";
import { teamVerificationSchema } from "./team-verification.js";

export const collaborationModeSchema = z.enum(["single", "same-model-team", "mixed-model-team"]);
export type CollaborationMode = z.infer<typeof collaborationModeSchema>;
export const memberRoleSchema = z.enum(["reasoning-checker", "material-checker", "practice-reviewer"]);
export const teamConfigurationSchema = z.object({
  mode: collaborationModeSchema.default("single"),
  members: z.array(z.object({ role: memberRoleSchema, provider: providerSchema.optional(), required: z.boolean().default(true), reasoning: z.enum(["quick", "balanced", "deep"]).optional(), timeoutMs: z.number().int().min(5000).max(180_000).optional(), maxOutputTokens: z.number().int().min(1024).max(8192).optional() }).strict()).min(1).max(2).default([{ role: "reasoning-checker", required: true }, { role: "material-checker", required: true }]),
  shareContext: z.boolean().default(false),
  maxConcurrency: z.number().int().min(1).max(2).default(2),
  maxModelTurns: z.number().int().min(4).max(24).default(12),
  maxToolCalls: z.number().int().min(1).max(48).default(24),
  maxInputTokens: z.number().int().min(8000).max(1_000_000).default(192_000),
  memberTimeoutMs: z.number().int().min(5000).max(180_000).default(180_000),
  maxOutputTokens: z.number().int().min(2048).max(48_000).default(16_384),
  timeoutMs: z.number().int().min(30_000).max(300_000).default(240_000),
}).strict();
export type TeamConfiguration = z.infer<typeof teamConfigurationSchema>;
export const modelBindingSchema = z.object({
  provider: providerSchema,
  model: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/),
  connection: z.string().min(1).max(2048),
  reasoning: z.enum(["quick", "balanced", "deep"]),
}).strict();
export type ModelBinding = z.infer<typeof modelBindingSchema>;
export type ModelIdentity = Omit<ModelBinding, "reasoning">;
export function sameModel(left: ModelIdentity, right: ModelIdentity): boolean { return left.provider === right.provider && left.model === right.model && left.connection === right.connection; }
export function validateTeamBindings(mode: CollaborationMode, lead: ModelBinding, members: readonly ModelBinding[]): void {
  if (mode === "single") return;
  if (!members.length || members.length > 2) throw new Error("team_configuration_invalid");
  if (mode === "same-model-team" && members.some(member => !sameModel(lead, member))) throw new Error("team_model_mismatch");
  // Identical model IDs behind multiple gateways do not prove model diversity.
  if (mode === "mixed-model-team" && new Set([lead, ...members].map(member => member.model.toLowerCase())).size < 2) throw new Error("team_models_not_distinct");
}
export const memberStatusSchema = z.enum(["queued", "running", "completed", "failed", "cancelled", "interrupted"]);
export const teamMemberSnapshotSchema = z.object({
  id: z.string().uuid(), role: memberRoleSchema, binding: modelBindingSchema,
  required: z.boolean(), status: memberStatusSchema, task: z.string().max(2000),
  attempts: z.number().int().min(0).max(12), durationMs: z.number().nonnegative().optional(),
  result: z.string().max(8000).optional(), error: z.string().max(300).optional(),
  report: teamReportSchema.optional(), failureCode: teamFailureSchema.optional(),
  submittedReasoning: z.string().max(32).optional(), outputTokenLimit: z.number().nonnegative().optional(),
  inputTokens: z.number().nonnegative().default(0), outputTokens: z.number().nonnegative().default(0),
});
const reviewStatusSchema = z.enum(["pending", "running", "completed", "failed", "skipped", "interrupted"]);
export const teamReviewSchema = z.object({
  status: reviewStatusSchema,
  verdict: teamReviewDecisionSchema.shape.verdict.optional(), issues: teamReviewDecisionSchema.shape.issues.optional(), guidance: teamReviewDecisionSchema.shape.guidance.optional(),
  failureCode: teamFailureSchema.optional(), durationMs: z.number().nonnegative().optional(),
  checks: teamReviewDecisionSchema.shape.checks,
  recheck: z.object({ status: reviewStatusSchema, verdict: teamReviewDecisionSchema.shape.verdict.optional(), issues: teamReviewDecisionSchema.shape.issues.optional(), guidance: teamReviewDecisionSchema.shape.guidance.optional(), checks: teamReviewDecisionSchema.shape.checks, failureCode: teamFailureSchema.optional() }).optional(),
  followUp: z.object({ member: z.number().int().min(1).max(2), question: z.string().max(1200), status: reviewStatusSchema, report: teamReportSchema.optional(), failureCode: teamFailureSchema.optional(), durationMs: z.number().nonnegative().optional() }).optional(),
});
export const teamSnapshotSchema = z.object({
  id: z.string().uuid(), mode: z.enum(["same-model-team", "mixed-model-team"]),
  status: z.enum(["preparing", "planning", "running", "merging", "completed", "partial", "failed", "interrupted", "not-needed"]),
  lead: modelBindingSchema, members: z.array(teamMemberSnapshotSchema).max(4),
  modelTurns: z.number().int().nonnegative(), toolCalls: z.number().int().nonnegative(),
  reservedOutputTokens: z.number().int().nonnegative(),
  estimatedInputTokens: z.number().int().nonnegative(),
  inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative(),
  unknownUsageRequests: z.number().int().nonnegative(),
  configHash: z.string().length(64).optional(), scopeHash: z.string().length(64).optional(),
  question: z.string().max(32_000).optional(),
  planning: z.enum(["pending", "running", "completed", "fallback", "interrupted"]).optional(),
  preparationMs: z.number().nonnegative().optional(),
  connections: z.array(z.object({ provider: providerSchema, status: z.enum(["preparing", "ready", "failed", "interrupted"]), failureCode: teamFailureSchema.optional(), durationMs: z.number().nonnegative().optional() }).strict()).max(5).optional(),
  protocol: z.union([z.literal(2), z.literal(3)]).optional(), review: teamReviewSchema.optional(), planningFailureCode: teamFailureSchema.optional(),
  packet: teamPacketSchema.optional(), tasks: z.array(teamTaskSchema).max(8).optional(),
  verification: teamVerificationSchema.optional(),
});
export type TeamSnapshot = z.infer<typeof teamSnapshotSchema>;
export const collaborationLabels: Record<CollaborationMode, string> = { single: "单 Agent", "same-model-team": "同模型团队", "mixed-model-team": "异模型团队" };
export const teamStatusLabels: Record<TeamSnapshot["status"], string> = { preparing: "准备模型连接", planning: "主模型分工", running: "成员核查与分歧复核", merging: "主模型综合", completed: "已完成", partial: "部分完成", failed: "未完成", interrupted: "已中断", "not-needed": "本轮由本地流程完成" };
export const memberStatusLabels: Record<TeamSnapshot["members"][number]["status"], string> = { queued: "等待执行", running: "核查中", completed: "已完成", failed: "未完成", cancelled: "已停止", interrupted: "已中断" };
export const teamTaskStatusLabels = { ...memberStatusLabels, blocked: "等待前置任务" };
export const teamVerificationLabels = { unresolved: "待核查", "model-reviewed": "已逐项模型审查", "evidence-linked": "已关联实际工具依据" };
export const memberRoleLabels: Record<z.infer<typeof memberRoleSchema>, string> = { "reasoning-checker": "推理核查", "material-checker": "事实与证据核查", "practice-reviewer": "实践与教学核查" };
export function teamModeConfiguration(mode: CollaborationMode, lead: z.infer<typeof providerSchema>, previous?: TeamConfiguration): TeamConfiguration {
  const defaults = (["pi-codex", "deepseek-api", "kimi-api"] as const).filter(provider => provider !== lead);
  return teamConfigurationSchema.parse({ ...previous, mode, members: (previous?.members ?? teamConfigurationSchema.parse({}).members).map((member, index) => ({ ...member, provider: member.provider ?? defaults[index] })) });
}
