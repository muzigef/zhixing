import type { ModelClient, ModelEvent, ModelRole } from "./model.js";
import { ProviderRegistry, type ProviderHealth } from "./provider-registry.js";

/** Resolves role-routed providers with a deterministic fallback client. */
export class ProviderRuntime {
  constructor(private readonly registry: ProviderRegistry, private readonly fallback: ModelClient) {}

  async *stream(role: ModelRole, prompt: string, signal: AbortSignal, onProvider?: (providerId: string) => void): AsyncIterable<ModelEvent> {
    const provider = this.registry.resolve(role) ?? this.fallback;
    onProvider?.(this.registry.routedProvider(role) ?? "mock");
    try {
      yield* provider.stream(prompt, signal);
    } catch (error) {
      if (provider === this.fallback || !(error instanceof Error) || !/^(provider_unavailable|provider_timeout|live_provider_disabled)/.test(error.message)) throw error;
      onProvider?.("mock");
      yield* this.fallback.stream(prompt, signal);
    }
  }

  async status(providerId: string, signal: AbortSignal): Promise<ProviderHealth> {
    return this.registry.health(providerId, signal);
  }
}
