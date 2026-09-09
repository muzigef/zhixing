import { z } from "zod/v4";
import { customProviderSchema } from "./api-connection-config.js";
export const providerSchema = z.union([customProviderSchema, z.enum(["pi-codex", "deepseek-api", "kimi-api", "demo", "mock", "codex-cli"])]);
export type AgentProvider = z.infer<typeof providerSchema>;
