import { imagesSchema } from "./image-input.js";
import { MAX_INPUT_CHARACTERS, MAX_CONVERSATION_MESSAGES, MAX_PENDING_REQUESTS } from "./input-limits.js";
import { teachingSessionSchema } from "./teaching-session-contracts.js";
import { z } from "zod/v4";
import { topicIdSchema } from "./contracts.js";
import { citationSchema } from "./learning-contracts.js";
import { assistantItemSchema } from "./assistant-interactions.js";
import { modelTimingSchema } from "./model-telemetry.js";
import { outcomeModeSchema, outcomeProtocolSchema } from "./outcome-contracts.js";
import { responseObservationSchema } from "./response-quality.js";
import { evidenceSupportSchema } from "./evidence-support.js";
import { accessSelectionSchema, permissionSchema, writeGrantSchema } from "./agent-permissions.js";
export const providerSchema = z.enum(["pi-codex", "deepseek-api", "demo", "mock", "codex-cli"]);
export const styleSchema = z.enum(["concise", "adaptive", "detailed"]);
export const reasoningSchema = z.enum(["quick", "balanced", "deep"]);
export const reasoningRequestSchema = z.enum(["auto", "quick", "balanced", "deep"]);
export const messageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  text: z.string().max(64_000),
  images: imagesSchema.optional(),
  status: z.enum(["running", "completed", "interrupted", "failed", "waiting", "blocked"]),
  items: z.array(assistantItemSchema).max(100).optional(),
  createdAt: z.string().datetime(),
  error: z.string().max(500).optional(),
  provider: providerSchema.optional(),
  style: styleSchema.optional(),
  model: z.string().max(128).optional(),
  reasoning: reasoningSchema.optional(),
  reasoningMode: z.literal("auto").optional(),
  quality: z.array(responseObservationSchema).max(7).optional(),
  evidenceSupport: evidenceSupportSchema.optional(),
  usage: z.object({ inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative(), cacheReadTokens: z.number().nonnegative().optional(), reasoningTokens: z.number().nonnegative().optional(), startupMs: z.number().nonnegative().optional() }).optional(),
  codeHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  access: accessSelectionSchema.optional(),
  profile: z.enum(["application", "custom"]).optional(),
  taskId: z.string().uuid().optional(),
  steerId: z.string().uuid().optional(),
  durationMs: z.number().nonnegative().optional(),
  firstTokenMs: z.number().nonnegative().optional(),
  contextUsage: z.object({ estimatedInputTokens: z.number().nonnegative(), reservedOutputTokens: z.number().positive(), windowTokens: z.number().positive(), chars: z.number().nonnegative(), omittedMessages: z.number().nonnegative(), omittedTurns: z.number().nonnegative(), estimateMultiplier: z.number().min(1).max(4).optional(), reportedInputTokens: z.number().nonnegative().optional() }).optional(),
  modelTimings: z.array(modelTimingSchema).max(12).optional(),
  citations: z.array(citationSchema).max(24).optional(),
  retrievedCitations: z.array(citationSchema).max(24).optional(),
  activities: z.array(z.object({ label: z.string().max(120), status: z.enum(["running", "completed", "failed"]), at: z.string().datetime() })).max(100).optional(),
  timings: z.object({ contextMs: z.number().nonnegative(), modelMs: z.number().nonnegative(), toolMs: z.number().nonnegative().optional(), compactionMs: z.number().nonnegative().optional(), turns: z.number().nonnegative(), toolCalls: z.number().nonnegative(), taskCompleted: z.boolean().optional() }).optional(),
});
export type ChatMessage = z.infer<typeof messageSchema>;
export const chatSchema = z.object({
  version: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6), z.literal(7), z.literal(8)]),
  id: z.string().uuid(),
  title: z.string().min(1).max(80),
  customTitle: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  messages: z.array(messageSchema).max(MAX_CONVERSATION_MESSAGES),
  topicId: topicIdSchema.optional(),
  workspaceId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  mode: z.enum(["chat", "lesson"]).optional(),
  teaching: teachingSessionSchema.nullable().optional(),
  study: z.object({ id: z.string().uuid(), mode: outcomeModeSchema, protocol: outcomeProtocolSchema.optional() }).optional(),
  contextAllowed: z.boolean().optional(),
  executionAllowed: z.boolean().optional(),
  permissions: permissionSchema.optional(),
  writeGrants: z.array(writeGrantSchema).max(64).optional(),
  parent: z.object({ sessionId: z.string().uuid(), messageId: z.string().uuid().optional() }).optional(),
  context: z.object({
    goal: z.string().max(4000), notes: z.string().max(4000),
    summary: z.string().max(4000).optional(), summaryThroughId: z.string().uuid().optional(),
    summarySourceHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), summaryAttemptFailed: z.boolean().optional(),
    lastAttemptId: z.string().uuid().optional(),
  }).optional(),
  pendingRequests: z.array(z.object({ mode: z.enum(["chat", "lesson"]).optional(), purpose: z.enum(["answer", "planning", "intent", "guidance", "evidence"]).optional(), id: z.string().uuid(), images: imagesSchema.optional(), text: z.string().min(1).max(MAX_INPUT_CHARACTERS), provider: providerSchema, style: styleSchema, reasoning: reasoningRequestSchema.optional(), topicId: topicIdSchema.optional(), contextAllowed: z.boolean().optional(), access: accessSelectionSchema.optional(), execution: z.enum(["read", "once", "session"]).optional(), resumeTaskId: z.string().uuid().optional(), steerId: z.string().uuid().optional(), enqueuedAt: z.string().datetime() })).max(MAX_PENDING_REQUESTS).optional(),
  queuePaused: z.boolean().optional(),
  queueError: z.string().max(500).optional(),
}).refine(value => !value.teaching || value.teaching.topicId === value.topicId, { message: "cross_topic_teaching_denied" });
export type ChatSession = z.infer<typeof chatSchema>;
export type SessionSummary = Omit<
  ChatSession,
  "version" | "messages" | "customTitle"
>;
export const dialoguePurposeSchema = z.enum(["answer", "planning", "intent", "guidance", "evidence"]);
export const agentSendSchema = z.object({
  sessionId: z.string().uuid(),
  mode: z.enum(["chat", "lesson"]).optional(),
  purpose: dialoguePurposeSchema.optional(),
  text: z.string().trim().min(1).max(MAX_INPUT_CHARACTERS),
  images: imagesSchema.optional(),
  provider: providerSchema,
  style: styleSchema,
  reasoning: reasoningRequestSchema.optional(),
  topicId: topicIdSchema.optional(),
  contextAllowed: z.boolean().optional(),
  access: accessSelectionSchema.optional(),
  execution: z.enum(["read", "once", "session"]).optional(),
  resumeTaskId: z.string().uuid().optional(),
  steerId: z.string().uuid().optional(),
}).strict();
export type SendRequest = z.infer<typeof agentSendSchema>;
export type AgentEvent =
  | { type: "session"; session: ChatSession }
  | { type: "message_patch"; sessionId: string; messageId: string; sequence: number; changes: Partial<Omit<ChatMessage, "id">> }
  | { type: "delta"; sessionId: string; messageId: string; text: string }
  | { type: "settled"; sessionId: string };
