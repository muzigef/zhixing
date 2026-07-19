import { isContinuableModelClient, type ModelClient, type ModelEvent, type ModelRole, type ToolResultMessage } from "./model.js";
import { ProviderRegistry, type ProviderHealth } from "./provider-registry.js";

/** Resolves role-routed providers with a deterministic fallback client. */
export class ProviderRuntime {
  constructor(private readonly registry: ProviderRegistry, private readonly fallback: ModelClient) {}

  async *stream(role: ModelRole, prompt: string, signal: AbortSignal, onProvider?: (providerId: string) => void, allowFallback = true): AsyncIterable<ModelEvent> {
    const provider = this.registry.resolve(role) ?? this.fallback;
    onProvider?.(this.registry.routedProvider(role) ?? "mock");
    try {
      yield* provider.stream(prompt, signal);
    } catch (error) {
      if (!allowFallback || provider === this.fallback || !(error instanceof Error) || !/^(provider_unavailable|provider_timeout|live_provider_disabled)/.test(error.message)) throw error;
      onProvider?.("mock");
      yield* this.fallback.stream(prompt, signal);
    }
  }

  /** Returns no stream when a routed provider has no safe continuation capability. */
  continue(role: ModelRole, prompt: string, toolResults: readonly ToolResultMessage[], signal: AbortSignal, onProvider?: (providerId: string) => void): AsyncIterable<ModelEvent> | undefined {
    const provider = this.registry.resolve(role);
    if (!provider || !isContinuableModelClient(provider)) return undefined;
    onProvider?.(this.registry.routedProvider(role) ?? "mock");
    return provider.continue(prompt, toolResults, signal);
  }

  async status(providerId: string, signal: AbortSignal): Promise<ProviderHealth> {
    return this.registry.health(providerId, signal);
  }
}
