import { z } from "zod";
import { topicIdSchema } from "./contracts.js";
import { citationSchema } from "./learning-contracts.js";
import { assistantItemSchema } from "./assistant-interactions.js";
import { modelTimingSchema } from "./model-telemetry.js";
import { outcomeModeSchema } from "./outcome-contracts.js";
export const providerSchema = z.enum(["pi-codex", "deepseek-api", "demo", "mock", "codex-cli"]);
export const styleSchema = z.enum(["concise", "adaptive", "detailed"]);
export const reasoningSchema = z.enum(["quick", "balanced", "deep"]);
export const messageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["user", "assistant"]),
  text: z.string().max(64_000),
  status: z.enum(["running", "completed", "interrupted", "failed", "waiting", "blocked"]),
  items: z.array(assistantItemSchema).max(100).optional(),
  createdAt: z.string().datetime(),
  error: z.string().max(500).optional(),
  provider: providerSchema.optional(),
  style: styleSchema.optional(),
  model: z.string().max(128).optional(),
  reasoning: reasoningSchema.optional(),
  usage: z.object({ inputTokens: z.number().nonnegative(), outputTokens: z.number().nonnegative(), cacheReadTokens: z.number().nonnegative().optional(), reasoningTokens: z.number().nonnegative().optional(), startupMs: z.number().nonnegative().optional() }).optional(),
  profile: z.enum(["application", "custom"]).optional(),
  taskId: z.string().uuid().optional(),
  steerId: z.string().uuid().optional(),
  durationMs: z.number().nonnegative().optional(),
  firstTokenMs: z.number().nonnegative().optional(),
  modelTimings: z.array(modelTimingSchema).max(6).optional(),
  citations: z.array(citationSchema).max(24).optional(),
  retrievedCitations: z.array(citationSchema).max(24).optional(),
  activities: z.array(z.object({ label: z.string().max(120), status: z.enum(["running", "completed", "failed"]), at: z.string().datetime() })).max(100).optional(),
  timings: z.object({ contextMs: z.number().nonnegative(), modelMs: z.number().nonnegative(), toolMs: z.number().nonnegative().optional(), compactionMs: z.number().nonnegative().optional(), turns: z.number().nonnegative(), toolCalls: z.number().nonnegative(), taskCompleted: z.boolean().optional() }).optional(),
});
export type ChatMessage = z.infer<typeof messageSchema>;
export const chatSchema = z.object({
  version: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  id: z.string().uuid(),
  title: z.string().min(1).max(80),
  customTitle: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  messages: z.array(messageSchema).max(1000),
  topicId: topicIdSchema.optional(),
  workspaceId: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  study: z.object({ id: z.string().uuid(), mode: outcomeModeSchema }).optional(),
  contextAllowed: z.boolean().optional(),
  executionAllowed: z.boolean().optional(),
  parent: z.object({ sessionId: z.string().uuid(), messageId: z.string().uuid().optional() }).optional(),
  context: z.object({
    goal: z.string().max(4000), notes: z.string().max(4000),
    summary: z.string().max(4000).optional(), summaryThroughId: z.string().uuid().optional(),
    lastAttemptId: z.string().uuid().optional(),
  }).optional(),
  pendingRequests: z.array(z.object({ id: z.string().uuid(), text: z.string().min(1).max(20_000), provider: providerSchema, style: styleSchema, reasoning: reasoningSchema.optional(), topicId: topicIdSchema.optional(), contextAllowed: z.boolean().optional(), execution: z.enum(["read", "once", "session"]).optional(), resumeTaskId: z.string().uuid().optional(), steerId: z.string().uuid().optional(), enqueuedAt: z.string().datetime() })).max(10).optional(),
  queuePaused: z.boolean().optional(),
  queueError: z.string().max(500).optional(),
});
export type ChatSession = z.infer<typeof chatSchema>;
export type SessionSummary = Omit<
  ChatSession,
  "version" | "messages" | "customTitle"
>;
export const agentSendSchema = z.object({
  sessionId: z.string().uuid(),
  text: z.string().trim().min(1).max(20_000),
  provider: providerSchema,
  style: styleSchema,
  reasoning: reasoningSchema.optional(),
  topicId: topicIdSchema.optional(),
  contextAllowed: z.boolean().optional(),
  execution: z.enum(["read", "once", "session"]).optional(),
  resumeTaskId: z.string().uuid().optional(),
  steerId: z.string().uuid().optional(),
});
export type SendRequest = z.infer<typeof agentSendSchema>;
export type AgentEvent =
  | { type: "session"; session: ChatSession }
  | { type: "delta"; sessionId: string; messageId: string; text: string }
  | { type: "settled"; sessionId: string };
