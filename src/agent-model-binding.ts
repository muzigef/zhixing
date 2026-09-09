import type { ModelClient, ReasoningProfile } from "./model.js";
import { abortable } from "./abortable.js";
import { modelBindingSchema, sameModel, type ModelBinding } from "./team-contracts.js";
import type { AgentProvider } from "./agent-provider.js";

/** Hosts can resolve preferences, but only this shared boundary freezes a member's identity. */
export async function bindAgentModel(provider: AgentProvider, client: ModelClient, reasoning: ReasoningProfile, signal: AbortSignal, expected?: ModelBinding): Promise<{ binding: ModelBinding; client: ModelClient }> {
  signal.throwIfAborted();
  const pinned = client.freeze ? await abortable(() => client.freeze!(), signal) : client;
  const identity = pinned.identity ?? (["demo", "mock"].includes(provider) ? { provider, model: provider, connection: "local" } : undefined);
  if (!identity) throw new Error("team_model_binding_required");
  const binding = modelBindingSchema.parse({ ...identity, reasoning });
  if (binding.provider !== provider || expected && (!sameModel(binding, expected) || binding.reasoning !== expected.reasoning)) throw new Error("team_model_mismatch");
  return { binding, client: pinned };
}
