import { z } from "zod";
import { topicIdSchema } from "../../src/contracts.js";
import { citationSchema, type WorkspaceSummary } from "../../src/learning-contracts.js";
import { dayIdSchema, evidenceKindSchema } from "../../src/evidence-store.js";
import { assistantItemSchema } from "../../src/assistant-interactions.js";

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
export const messageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  text: z.string().max(64_000),
  status: z.enum(["running", "completed", "interrupted", "failed", "waiting"]),
  items: z.array(assistantItemSchema).max(100).optional(),
  createdAt: z.string().datetime(),
  error: z.string().max(500).optional(),
  provider: providerSchema.optional(),
  model: z.string().max(128).optional(),
  reasoning: reasoningSchema.optional(),
  usage: z.object({ inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative(), cacheReadTokens: z.number().nonnegative().optional(), reasoningTokens: z.number().nonnegative().optional(), startupMs: z.number().nonnegative().optional() }).optional(),
  taskId: z.string().uuid().optional(),
  durationMs: z.number().nonnegative().optional(),
  firstTokenMs: z.number().nonnegative().optional(),
  citations: z.array(citationSchema).max(24).optional(),
  retrievedCitations: z.array(citationSchema).max(24).optional(),
  activities: z.array(z.object({ label: z.string().max(120), status: z.enum(["running", "completed", "failed"]), at: z.string().datetime() })).max(100).optional(),
  timings: z.object({ contextMs: z.number().nonnegative(), modelMs: z.number().nonnegative(), compactionMs: z.number().nonnegative().optional(), turns: z.number().nonnegative(), toolCalls: z.number().nonnegative(), taskCompleted: z.boolean().optional() }).optional(),
});
export type ChatMessage = z.infer<typeof messageSchema>;
export const chatSchema = z.object({
  version: z.union([z.literal(1), z.literal(2)]),
  id: z.string().uuid(),
  title: z.string().min(1).max(80),
  customTitle: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  messages: z.array(messageSchema).max(1000),
  topicId: topicIdSchema.optional(),
  workspaceId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  contextAllowed: z.boolean().optional(),
  executionAllowed: z.boolean().optional(),
  parent: z.object({ sessionId: z.string().uuid(), messageId: z.string().uuid().optional() }).optional(),
  context: z.object({
    goal: z.string().max(4000), notes: z.string().max(4000),
    summary: z.string().max(4000).optional(), summaryThroughId: z.string().uuid().optional(),
    lastAttemptId: z.string().uuid().optional(),
  }).optional(),
  pendingRequests: z.array(z.object({ id: z.string().uuid(), text: z.string().min(1).max(20_000), provider: providerSchema, style: styleSchema, reasoning: reasoningSchema.optional(), enqueuedAt: z.string().datetime() })).max(10).optional(),
  queuePaused: z.boolean().optional(),
  queueError: z.string().max(500).optional(),
});
export type ChatSession = z.infer<typeof chatSchema>;
export type SessionSummary = Omit<
  ChatSession,
  "version" | "messages" | "customTitle"
>;
export const sendSchema = z.object({
  sessionId: z.string().uuid(),
  text: z.string().trim().min(1).max(20_000),
  provider: providerSchema,
  style: styleSchema,
  reasoning: reasoningSchema.optional(),
  topicId: topicIdSchema.optional(),
  contextAllowed: z.boolean().optional(),
  execution: z.enum(["read", "once", "session"]).optional(),
  resumeTaskId: z.string().uuid().optional(),
});
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
export type DesktopEvent =
  | { type: "session"; session: ChatSession }
  | { type: "delta"; sessionId: string; messageId: string; text: string }
  | { type: "settled"; sessionId: string };
export type DesktopResult =
  { ok: true; data: unknown } | { ok: false; error: string };
export interface DesktopBridge {
  invoke(command: DesktopCommand): Promise<DesktopResult>;
  subscribe(callback: (event: DesktopEvent) => void): () => void;
  platform: string;
}
