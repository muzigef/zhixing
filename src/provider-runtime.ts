import { isContinuableModelClient, type ModelClient, type ModelEvent, type ModelRole, type ToolResultMessage, type ModelRequestOptions } from "./model.js";
import { ProviderRegistry, type ProviderHealth } from "./provider-registry.js";

/** Resolves role-routed providers with a deterministic fallback client. */
export class ProviderRuntime {
  constructor(private readonly registry: ProviderRegistry, private readonly fallback: ModelClient) {}

  /** Pin a route so changing role settings cannot move an in-flight tool history. */
  forInvocation(role: ModelRole): ProviderRuntime {
    const registry = new ProviderRegistry();
    const id = this.registry.routedProvider(role) ?? "mock";
    registry.register({ id, client: this.registry.resolve(role) ?? this.fallback, health: async () => "unknown" });
    registry.route(role, id);
    return new ProviderRuntime(registry, this.fallback);
  }

  async *stream(role: ModelRole, prompt: string, signal: AbortSignal, onProvider?: (providerId: string) => void, allowFallback = true, options?: ModelRequestOptions): AsyncIterable<ModelEvent> {
    const provider = this.registry.resolve(role) ?? this.fallback;
    onProvider?.(this.registry.routedProvider(role) ?? "mock");
    let emitted = false;
    try {
      for await (const event of provider.stream(prompt, signal, options)) {
        emitted = true;
        yield event;
      }
    } catch (error) {
      // Once text or a tool request escaped, fallback would mix speakers or
      // hide a partially executed action. Let the invocation report the failure.
      if (emitted || signal.aborted || !allowFallback || provider === this.fallback || !(error instanceof Error) || !/^(provider_unavailable|provider_timeout|live_provider_disabled)/.test(error.message)) throw error;
      onProvider?.("mock");
      yield* this.fallback.stream(prompt, signal);
    }
  }

  /** Returns no stream when a routed provider has no safe continuation capability. */
  continue(role: ModelRole, prompt: string, toolResults: readonly ToolResultMessage[], signal: AbortSignal, onProvider?: (providerId: string) => void, options?: ModelRequestOptions): AsyncIterable<ModelEvent> | undefined {
    const provider = this.registry.resolve(role);
    if (!provider || !isContinuableModelClient(provider)) return undefined;
    onProvider?.(this.registry.routedProvider(role) ?? "mock");
    return provider.continue(prompt, toolResults, signal, options);
  }

  /** Let the control plane reject tool workflows for text-only adapters. */
  supportsTools(role: ModelRole): boolean {
    const provider = this.registry.resolve(role);
    return Boolean(provider && isContinuableModelClient(provider));
  }

  async status(providerId: string, signal: AbortSignal): Promise<ProviderHealth> {
    return this.registry.health(providerId, signal);
  }
}
