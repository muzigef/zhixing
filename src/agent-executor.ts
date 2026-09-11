import type { ModelClient, ModelMessage, ModelUsage, ReasoningProfile } from "./model.js";
import type { ModelCapabilities } from "./model-capabilities.js";
import { modelContextWindow } from "./context-window.js";
import type { ContextBudget } from "./context-window.js";

export interface AgentExecutionResult {
  text: string; usage?: ModelUsage; runtimeTurns?: number;
  /** A process completion is not evidence that the answer was verified. */
  status: "completed"; verification: "unverified";
}
export interface AgentExecutor {
  readonly kind: "agent-executor";
  readonly capabilities: ModelCapabilities;
  readonly identity: { provider: string; model: string; connection: string };
  readonly contextBudget?: ContextBudget;
  prepare(signal: AbortSignal): Promise<void>;
  execute(request: { messages: readonly ModelMessage[]; reasoning?: ReasoningProfile; maxOutputChars: number }, signal: AbortSignal, onText?: (text: string) => void): Promise<AgentExecutionResult>;
}
export type AgentBackend = ModelClient | AgentExecutor;
export function isAgentExecutor(value: AgentBackend): value is AgentExecutor { return "kind" in value && value.kind === "agent-executor"; }
export async function executeAgent(executor: AgentExecutor, input: { prompt: string; messages?: readonly ModelMessage[]; reasoning?: ReasoningProfile; maxOutputChars?: number }, signal: AbortSignal, onText?: (text: string) => void) {
  const view = modelContextWindow({ ...input, history: [] }, 80_000, executor.contextBudget ?? { windowTokens: 48_000, reserveOutputTokens: 16_384 });
  await executor.prepare(signal);
  const result = await executor.execute({ messages: view.messages, reasoning: input.reasoning, maxOutputChars: input.maxOutputChars ?? 64_000 }, signal, onText);
  signal.throwIfAborted();
  if (result.status !== "completed" || !result.text.trim() || result.text.length > (input.maxOutputChars ?? 64_000)) throw new Error("provider_incomplete");
  return { ...result, contextUsage: view.usage };
}
