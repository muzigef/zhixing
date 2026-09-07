import { z } from "zod";
import { topicIdSchema } from "../../src/contracts.js";
import { citationSchema, type WorkspaceSummary } from "../../src/learning-contracts.js";
import { dayIdSchema, evidenceKindSchema } from "../../src/evidence-store.js";
import { outcomeModeSchema, outcomePhaseSchema, outcomeSubmissionSchema } from "../../src/outcome-contracts.js";

export const providerSchema = z.enum(["pi-codex", "deepseek-api", "demo"]);
export const styleSchema = z.enum(["concise", "adaptive", "detailed"]);
export const reasoningSchema = z.enum(["quick", "balanced", "deep"]);
export const settingsSchema = z.object({
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
  z.object({ type: z.literal("boot") }),
  z.object({ type: z.literal("new") }),
  z.object({ type: z.literal("fork"), sessionId: z.string().uuid(), messageId: z.string().uuid().optional(), edit: z.boolean().optional() }),
  z.object({ type: z.literal("answer"), sessionId: z.string().uuid(), itemId: z.string().uuid(), answer: z.string().trim().min(1).max(4000), scope: z.enum(["once", "session"]).optional() }),
  z.object({ type: z.literal("load"), sessionId: z.string().uuid() }),
  sendSchema.extend({ type: z.literal("send") }),
  sendSchema.extend({ type: z.literal("enqueue"), steer: z.boolean().optional() }),
  z.object({ type: z.literal("resume-queue"), sessionId: z.string().uuid() }),
  z.object({ type: z.literal("withdraw"), sessionId: z.string().uuid(), requestId: z.string().uuid() }),
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
  z.object({ type: z.literal("copy"), text: z.string().max(100_000) }),
  z.object({ type: z.literal("learning-overview"), topicId: topicIdSchema }),
  z.object({ type: z.literal("outcome-list"), topicId: topicIdSchema }),
  z.object({ type: z.literal("outcome-export"), topicId: topicIdSchema }),
  z.object({ type: z.literal("outcome-start"), topicId: topicIdSchema, mode: outcomeModeSchema }),
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
  z.object({ type: z.literal("assessment-submit"), topicId: topicIdSchema, dayId: dayIdSchema, attemptId: z.string().uuid(), answers: z.array(z.number().int().min(0).max(2)).max(5), reflection: z.string().max(4000) }),
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
  workspace?: WorkspaceSummary;
  api: ApiStatus;
  sessions: SessionSummary[];
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
