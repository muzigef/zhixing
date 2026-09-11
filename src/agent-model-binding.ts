import type { ReasoningProfile } from "./model.js";
import { isAgentExecutor, type AgentBackend } from "./agent-executor.js";
import { abortable } from "./abortable.js";
import { modelBindingSchema, sameModel, type ModelBinding } from "./team-contracts.js";
import type { AgentProvider } from "./agent-provider.js";

/** Hosts can resolve preferences, but only this shared boundary freezes a member's identity. */
export async function bindAgentModel<T extends AgentBackend>(provider: AgentProvider, client: T, reasoning: ReasoningProfile, signal: AbortSignal, expected?: ModelBinding): Promise<{ binding: ModelBinding; client: T }> {
  signal.throwIfAborted();
  const pinned = !isAgentExecutor(client) && client.freeze ? await abortable(() => client.freeze!(), signal) : client;
  const identity = pinned.identity ?? (["demo", "mock"].includes(provider) ? { provider, model: provider, connection: "local" } : undefined);
  if (!identity) throw new Error("team_model_binding_required");
  if (isAgentExecutor(pinned) && ["official-runtime-selected", "auto"].includes(identity.model)) throw new Error("native_model_required");
  const binding = modelBindingSchema.parse({ ...identity, ...(provider === "codex-cli" && identity.provider === "native-codex" ? { provider } : {}), reasoning });
  if (binding.provider !== provider || expected && (!sameModel(binding, expected) || binding.reasoning !== expected.reasoning)) throw new Error("team_model_mismatch");
  return { binding, client: pinned as T };
}
