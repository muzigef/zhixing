import { apiConnectionInputSchema, type ApiConnection, customProviderSchema } from "../../src/api-connection-config.js";
import { accessSelectionSchema } from "../../src/agent-permissions.js";
import { projectEditSchema, projectPathSchema } from "../../src/practice-projects.js";
import { mcpServerSchema } from "../../src/mcp-settings.js";
import { z } from "zod/v4";
import { topicIdSchema } from "../../src/contracts.js";
import { citationSchema, type WorkspaceSummary } from "../../src/learning-contracts.js";
import { dayIdSchema, evidenceKindSchema } from "../../src/evidence-store.js";
import { outcomeProtocolSchema, outcomeModeSchema, outcomePhaseSchema, outcomeSubmissionSchema, explanationReviewInputSchema } from "../../src/outcome-contracts.js";
import { assistanceSchema } from "../../src/learning-observations.js";
import { recoveryReportSchema } from "../../src/task-continuity.js";
import { contextBudgetSchema } from "../../src/model-capabilities.js";
import { teamConfigurationSchema } from "../../src/team-contracts.js";

export const providerSchema = z.union([customProviderSchema, z.enum(["pi-codex", "deepseek-api", "kimi-api", "demo"])]);
export const styleSchema = z.enum(["concise", "adaptive", "detailed"]);
export const reasoningSchema = z.enum(["auto", "quick", "balanced", "deep"]);
export const settingsSchema = z.object({
  collaboration: teamConfigurationSchema.optional(),
  contextBudget: contextBudgetSchema.optional(),
  provider: providerSchema.default("pi-codex"),
  style: styleSchema.default("adaptive"),
  reasoning: reasoningSchema.optional(),
  semanticModel: z.string().regex(/^(?:[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127})?$/).optional(),
  theme: z.enum(["system", "light", "dark"]).default("system"),
  deepseekModel: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/)
    .default("deepseek-v4-flash"),
});
export type DesktopSettings = z.infer<typeof settingsSchema>;
export { messageSchema, chatSchema } from "../../src/agent-session-contracts.js";
export type { ChatMessage, ChatSession, SessionSummary, AgentEvent as DesktopEvent } from "../../src/agent-session-contracts.js";
import { agentSendSchema, type SessionSummary, type AgentEvent as DesktopEvent } from "../../src/agent-session-contracts.js";
export const sendSchema = agentSendSchema.extend({ provider: providerSchema });
export type SendRequest = z.infer<typeof sendSchema>;
export const desktopCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("team-evaluate"), suite: z.enum(["pilot", "holdout", "regression", "quality"]) }).strict(),
  z.object({ type: z.literal("team-evaluation-status") }).strict(),
  z.object({ type: z.literal("team-stop-member"), sessionId: z.string().uuid(), memberId: z.string().uuid() }).strict(),
  z.object({ type: z.literal("reminder-status"), topicId: topicIdSchema }),
  z.object({ type: z.literal("reminder-save"), topicId: topicIdSchema, time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), enabled: z.boolean() }),
  z.object({ type: z.literal("task-info"), sessionId: z.string().uuid(), taskId: z.string().uuid() }),
  z.object({ type: z.literal("task-report"), sessionId: z.string().uuid(), taskId: z.string().uuid(), callId: z.string().min(1).max(300), report: recoveryReportSchema }),
  z.object({ type: z.literal("task-verify"), sessionId: z.string().uuid(), taskId: z.string().uuid(), callId: z.string().min(1).max(300) }),
  z.object({ type: z.literal("task-revise"), sessionId: z.string().uuid(), taskId: z.string().uuid(), revision: z.number().int().nonnegative(), goal: z.string().trim().min(1).max(4000) }),
  z.object({ type: z.literal("boot") }),
  z.object({ type: z.literal("sessions"), query: z.string().max(200).optional(), cursor: z.string().max(500).optional() }),
  z.object({ type: z.literal("new") }),
  z.object({ type: z.literal("fork"), sessionId: z.string().uuid(), messageId: z.string().uuid().optional(), edit: z.boolean().optional() }),
  z.object({ type: z.literal("answer"), sessionId: z.string().uuid(), itemId: z.string().uuid(), answer: z.string().trim().min(1).max(4000), scope: z.enum(["once", "session"]).optional() }),
  z.object({ type: z.literal("load"), sessionId: z.string().uuid() }),
  sendSchema.extend({ type: z.literal("send") }),
  sendSchema.extend({ type: z.literal("enqueue"), steer: z.boolean().optional() }),
  z.object({ type: z.literal("resume-queue"), sessionId: z.string().uuid() }),
  z.object({ type: z.literal("withdraw"), sessionId: z.string().uuid(), requestId: z.string().uuid() }),
  z.object({ type: z.literal("permissions"), sessionId: z.string().uuid(), access: accessSelectionSchema, clearWriteGrants: z.boolean().optional() }),
  z.object({ type: z.literal("context"), sessionId: z.string().uuid(), goal: z.string().max(4000), notes: z.string().max(4000) }),
  z.object({ type: z.literal("stop") }),
  z.object({
    type: z.literal("rename"),
    sessionId: z.string().uuid(),
    title: z.string().trim().min(1).max(80),
  }),
  z.object({ type: z.literal("settings"), settings: settingsSchema }),
  z.object({ type: z.literal("export"), sessionId: z.string().uuid() }),
  z.object({ type: z.literal("open-link"), url: z.string().url().max(4096) }),
  z.object({
    type: z.literal("configure-deepseek"),
    apiKey: z.string().trim().min(8).max(4096),
  }),
  z.object({ type: z.literal("configure-kimi"), apiKey: z.string().trim().min(8).max(4096) }),
  z.object({ type: z.literal("check-api"), provider: z.union([customProviderSchema, z.enum(["deepseek-api", "kimi-api"])]) }),
  z.object({ type: z.literal("api-connection-save"), revision: z.number().int().nonnegative(), connection: apiConnectionInputSchema, apiKey: z.string().trim().min(8).max(4096).optional() }).strict(),
  z.object({ type: z.literal("api-connection-remove"), revision: z.number().int().nonnegative(), id: customProviderSchema }).strict(),
  z.object({ type: z.literal("copy"), text: z.string().max(100_000) }),
  z.object({ type: z.literal("learning-overview"), topicId: topicIdSchema }),
  z.object({ type: z.literal("project-list"), topicId: topicIdSchema }),
  z.object({ type: z.literal("project-create"), topicId: topicIdSchema, title: z.string().trim().min(1).max(80), language: z.enum(["javascript", "python"]).optional() }),
  z.object({ type: z.literal("project-import"), topicId: topicIdSchema, title: z.string().trim().min(1).max(80) }),
  z.object({ type: z.literal("project-select"), topicId: topicIdSchema, projectId: z.string().uuid().nullable() }),
  z.object({ type: z.literal("project-view"), topicId: topicIdSchema, projectId: z.string().uuid() }),
  z.object({ type: z.literal("project-read"), topicId: topicIdSchema, projectId: z.string().uuid(), path: projectPathSchema }),
  z.object({ type: z.literal("project-preview"), topicId: topicIdSchema, projectId: z.string().uuid(), edit: projectEditSchema }),
  z.object({ type: z.literal("project-write"), topicId: topicIdSchema, projectId: z.string().uuid(), edit: projectEditSchema }),
  z.object({ type: z.literal("project-restore-preview"), topicId: topicIdSchema, projectId: z.string().uuid(), snapshotId: z.string().uuid(), expectedTreeHash: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.object({ type: z.literal("project-restore"), topicId: topicIdSchema, projectId: z.string().uuid(), snapshotId: z.string().uuid(), expectedTreeHash: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.object({ type: z.literal("project-test"), topicId: topicIdSchema, projectId: z.string().uuid(), expectedTreeHash: z.string().regex(/^[a-f0-9]{64}$/) }),
  z.object({ type: z.literal("project-checkpoint"), topicId: topicIdSchema, projectId: z.string().uuid(), expectedTreeHash: z.string().regex(/^[a-f0-9]{64}$/), title: z.string().trim().min(1).max(120) }),
  z.object({ type: z.literal("mcp-settings"), topicId: topicIdSchema }),
  z.object({ type: z.literal("mcp-save"), topicId: topicIdSchema, revision: z.number().int().nonnegative(), servers: z.array(mcpServerSchema).max(4) }),
  z.object({ type: z.literal("mcp-test"), topicId: topicIdSchema, serverId: z.string().max(24) }),
  z.object({ type: z.literal("outcome-list"), topicId: topicIdSchema }),
  z.object({ type: z.literal("outcome-review-explanation"), topicId: topicIdSchema, id: z.string().uuid(), phase: outcomePhaseSchema, review: explanationReviewInputSchema }),
  z.object({ type: z.literal("observation-update"), topicId: topicIdSchema, id: z.string().uuid(), revision: z.number().int().positive(), annotation: z.string().max(2000), withdrawn: z.boolean() }),
  z.object({ type: z.literal("outcome-export"), topicId: topicIdSchema }),
  z.object({ type: z.literal("outcome-start"), topicId: topicIdSchema, mode: outcomeModeSchema, protocol: outcomeProtocolSchema.optional() }),
  z.object({ type: z.literal("outcome-submit"), topicId: topicIdSchema, id: z.string().uuid(), phase: outcomePhaseSchema, submission: outcomeSubmissionSchema }),
  z.object({ type: z.literal("outcome-lesson"), topicId: topicIdSchema, id: z.string().uuid() }),
  z.object({ type: z.literal("outcome-finish-lesson"), topicId: topicIdSchema, id: z.string().uuid() }),
  z.object({ type: z.literal("outcome-retention"), topicId: topicIdSchema, id: z.string().uuid() }),
  z.object({ type: z.literal("outcome-abandon"), topicId: topicIdSchema, id: z.string().uuid() }),
  z.object({ type: z.literal("semantic-index"), topicId: topicIdSchema }),
  z.object({ type: z.literal("skills-list"), topicId: topicIdSchema }),
  z.object({ type: z.literal("skill-read"), topicId: topicIdSchema, name: z.string().min(1).max(100) }),
  z.object({ type: z.literal("learning-action"), topicId: topicIdSchema, command: z.string().regex(/^(开始第\s*\d{1,2}\s*天|开始任务|继续|进度|下一步)$/) }),
  z.object({ type: z.literal("learning-import"), topicId: topicIdSchema }),
  z.object({ type: z.literal("learning-cancel") }),
  z.object({ type: z.literal("learning-source"), topicId: topicIdSchema, citation: citationSchema }),
  z.object({ type: z.literal("workspace-select") }),
  z.object({ type: z.literal("workspace-backup") }),
  z.object({ type: z.literal("workspace-restore") }),
  z.object({ type: z.literal("diagnostics") }),
  z.object({ type: z.literal("check-updates") }),
  z.object({ type: z.literal("evidence-list"), topicId: topicIdSchema, dayId: dayIdSchema }),
  z.object({ type: z.literal("evidence-submit"), topicId: topicIdSchema, dayId: dayIdSchema, kind: evidenceKindSchema, text: z.string().min(8).max(256_000) }),
  z.object({ type: z.literal("evidence-file"), topicId: topicIdSchema, dayId: dayIdSchema, kind: evidenceKindSchema }),
  z.object({ type: z.literal("evidence-validate"), topicId: topicIdSchema, dayId: dayIdSchema }),
  z.object({ type: z.literal("evidence-review"), topicId: topicIdSchema, dayId: dayIdSchema }),
  z.object({ type: z.literal("assessment-start"), topicId: topicIdSchema, dayId: dayIdSchema }),
  z.object({ type: z.literal("assessment-submit"), topicId: topicIdSchema, dayId: dayIdSchema, attemptId: z.string().uuid(), answers: z.array(z.number().int().min(0).max(2)).max(5), reflection: z.string().max(4000), assistance: assistanceSchema.optional() }),
]);
export type DesktopCommand = z.infer<typeof desktopCommandSchema>;
export interface ModelStatus {
  configured: boolean;
  provider: "pi-codex";
  model?: string;
  thinking?: string;
  message: string;
}
export interface ApiStatus {
  configured: boolean;
  model: string;
  source?: "desktop" | "system-keychain";
  message: string;
}
export interface BootState {
  apiConnections?: { revision: number; connections: (ApiConnection & { configured: boolean })[] };
  workspace?: WorkspaceSummary;
  api: ApiStatus;
  kimiApi?: ApiStatus;
  sessions: SessionSummary[];
  nextSessionCursor?: string | null;
  settings: DesktopSettings;
  model: ModelStatus;
  activeSessionId: string | null;
}
export type DesktopResult =
  { ok: true; data: unknown } | { ok: false; error: string };
export interface DesktopBridge {
  invoke(command: DesktopCommand): Promise<DesktopResult>;
  subscribe(callback: (event: DesktopEvent) => void): () => void;
  platform: string;
}
