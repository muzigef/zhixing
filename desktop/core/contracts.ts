import { z } from "zod";

export const providerSchema = z.enum(["pi-codex", "deepseek-api", "demo"]);
export const styleSchema = z.enum(["concise", "adaptive", "detailed"]);
export const settingsSchema = z.object({
  provider: providerSchema.default("pi-codex"),
  style: styleSchema.default("adaptive"),
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
  status: z.enum(["running", "completed", "interrupted", "failed"]),
  createdAt: z.string().datetime(),
  error: z.string().max(500).optional(),
  provider: providerSchema.optional(),
  model: z.string().max(128).optional(),
  durationMs: z.number().nonnegative().optional(),
  firstTokenMs: z.number().nonnegative().optional(),
});
export type ChatMessage = z.infer<typeof messageSchema>;
export const chatSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  title: z.string().min(1).max(80),
  customTitle: z.boolean().default(false),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  messages: z.array(messageSchema).max(1000),
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
});
export type SendRequest = z.infer<typeof sendSchema>;
export const desktopCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("boot") }),
  z.object({ type: z.literal("new") }),
  z.object({ type: z.literal("load"), sessionId: z.string().uuid() }),
  sendSchema.extend({ type: z.literal("send") }),
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
