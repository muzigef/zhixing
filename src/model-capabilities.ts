import { z } from "zod/v4";
import type { ModelClient, ContinuableModelClient } from "./model.js";
import type { ContextBudget } from "./context-window.js";

export interface ModelCapabilities { inputModalities: readonly ("text" | "image")[]; toolCalling: boolean; continuation: boolean; contextWindowTokens: number; maxOutputTokens: number; outputLimit: "configurable" | "adapter_default" | "unknown"; source: "adapter_policy"; }
export const contextBudgetSchema = z.object({ windowTokens: z.number().int().min(512).max(48_000), reserveOutputTokens: z.number().int().min(128).max(16_384) }).strict().refine(value => value.reserveOutputTokens < value.windowTokens);
export function adapterCapabilities(tools: boolean, outputLimit: ModelCapabilities["outputLimit"] = "unknown"): ModelCapabilities { return { inputModalities: ["text"], toolCalling: tools, continuation: tools, contextWindowTokens: 48_000, maxOutputTokens: 16_384, outputLimit, source: "adapter_policy" }; }
export function capabilitiesFor(client: ModelClient): ModelCapabilities { return client.capabilities ?? adapterCapabilities(typeof (client as Partial<ContinuableModelClient>).continue === "function"); }
export function effectiveModelBudget(client: ModelClient, requested?: ContextBudget): ContextBudget {
  const capabilities = capabilitiesFor(client);
  const parsed = contextBudgetSchema.safeParse(requested ?? client.contextBudget ?? { windowTokens: capabilities.contextWindowTokens, reserveOutputTokens: capabilities.maxOutputTokens });
  if (!parsed.success || parsed.data.windowTokens > capabilities.contextWindowTokens || parsed.data.reserveOutputTokens > capabilities.maxOutputTokens || capabilities.outputLimit === "adapter_default" && parsed.data.reserveOutputTokens !== capabilities.maxOutputTokens) throw new Error("context_budget_invalid");
  return parsed.data;
}
export function outputTokenLimit(value = 16_384): number { return contextBudgetSchema.shape.reserveOutputTokens.parse(value); }
/** SDK metadata is checked before transport; local policy remains a deliberate upper bound. */
export function resolveSdkBudget(model: { contextWindow: number; maxTokens: number }, requested?: number) {
  if (![model.contextWindow, model.maxTokens].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("provider_capabilities_invalid");
  const windowTokens = Math.min(model.contextWindow, 48_000);
  const reserveOutputTokens = Math.min(model.maxTokens, outputTokenLimit(requested));
  if (reserveOutputTokens >= windowTokens) throw new Error("model_input_limit");
  return { windowTokens, reserveOutputTokens, providerContextWindow: model.contextWindow, providerMaxOutput: model.maxTokens };
}
/** Pi input excludes cache reads/writes; the public application contract is total input tokens. */
export function piReportedUsage(value: { input: number; output: number; cacheRead: number; cacheWrite: number; reasoning?: number }) {
  return { inputTokens: value.input + value.cacheRead + value.cacheWrite, outputTokens: value.output, cacheReadTokens: value.cacheRead, reasoningTokens: value.reasoning };
}
export function environmentContextBudget(environment: NodeJS.ProcessEnv): ContextBudget | undefined {
  if (environment.ZHIXING_CONTEXT_WINDOW_TOKENS === undefined && environment.ZHIXING_OUTPUT_TOKENS === undefined) return undefined;
  const value = contextBudgetSchema.safeParse({ windowTokens: Number(environment.ZHIXING_CONTEXT_WINDOW_TOKENS ?? 48_000), reserveOutputTokens: Number(environment.ZHIXING_OUTPUT_TOKENS ?? 16_384) });
  if (!value.success) throw new Error("context_budget_invalid"); return value.data;
}
export function withModelBudget(client: ModelClient, contextBudget?: ContextBudget): ModelClient {
  return { stream: client.stream.bind(client), ...(client.prepare ? { prepare: client.prepare.bind(client) } : {}), identity: client.identity, ...(client.freeze ? { freeze: async () => withModelBudget(await client.freeze!(), contextBudget) } : {}), capabilities: capabilitiesFor(client), contextBudget: contextBudget ?? client.contextBudget, ...(typeof (client as Partial<ContinuableModelClient>).continue === "function" ? { continue: (client as ContinuableModelClient).continue.bind(client) } : {}) };
}
