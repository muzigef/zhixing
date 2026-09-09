import { z } from "zod/v4";

export const customProviderSchema = z.string().regex(/^api-[a-f0-9]{32}$/).transform(value => value as `api-${string}`);
export type CustomProvider = z.infer<typeof customProviderSchema>;
const baseUrlSchema = z.string().trim().max(2048).transform(value => value.replace(/\/+$/, "")).refine(value => {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) &&
      !url.username && !url.password && !url.search && !url.hash && !/[\\\s]/.test(value) &&
      !/\/(?:chat\/completions|responses|messages)$/.test(url.pathname);
  } catch { return false; }
}, "请填写 API 根地址（HTTPS，或本机 HTTP），不要包含密钥、查询参数或 /chat/completions。");

/** Public configuration only. No arbitrary headers, payload overrides or secrets. */
const definitionSchema = z.object({
  name: z.string().trim().min(1).max(60).refine(value => [...value].every(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127)),
  protocol: z.literal("openai-chat-completions").default("openai-chat-completions"),
  baseUrl: baseUrlSchema,
  model: z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/),
  tools: z.boolean().default(true),
  images: z.boolean().default(false),
  reasoning: z.enum(["none", "openai", "deepseek", "kimi"]).default("none"),
  tokenField: z.enum(["max_tokens", "max_completion_tokens"]).default("max_tokens"),
  streamUsage: z.boolean().default(true),
  contextWindow: z.number().int().min(2048).max(48_000).default(48_000),
  maxOutputTokens: z.number().int().min(128).max(16_384).default(4096),
}).strict();
const validBudget = (value: { maxOutputTokens: number; contextWindow: number }) => value.maxOutputTokens < value.contextWindow;
export const apiConnectionInputSchema = definitionSchema.refine(validBudget, "回答上限必须小于上下文窗口。");
export const apiConnectionSchema = definitionSchema.extend({ id: customProviderSchema }).refine(validBudget);
export type ApiConnectionInput = z.infer<typeof apiConnectionInputSchema>;
export type ApiConnection = z.infer<typeof apiConnectionSchema>;
export const apiConnectionsSchema = z.object({ version: z.literal(1), revision: z.number().int().nonnegative(), connections: z.array(apiConnectionSchema).max(20) }).strict();
export type ApiConnectionsState = z.infer<typeof apiConnectionsSchema>;
export function isCustomProvider(provider: string): provider is CustomProvider { return customProviderSchema.safeParse(provider).success; }
export function providerLabel(provider: string, connections: readonly ApiConnection[] = []): string {
  const builtin: Record<string, string> = { "pi-codex": "Pi · Codex", "deepseek-api": "DeepSeek API", "kimi-api": "Kimi API", demo: "离线演示", mock: "本地 Mock", "codex-cli": "Codex CLI" };
  return builtin[provider] ?? connections.find(item => item.id === provider)?.name ?? "自定义 API";
}
