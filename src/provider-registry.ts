import type { ModelClient, ModelRole } from "./model.js";

export type ProviderHealth = "healthy" | "unavailable" | "unknown";
export interface ProviderAdapter {
  readonly id: string;
  readonly client: ModelClient;
  health(signal: AbortSignal): Promise<ProviderHealth>;
}

/** Routes roles through registered providers and falls back without exposing credentials. */
export class ProviderRegistry {
  readonly #providers = new Map<string, ProviderAdapter>();
  readonly #routing = new Map<ModelRole, string>();

  register(provider: ProviderAdapter): void {
    if (this.#providers.has(provider.id)) throw new Error(`provider_duplicate: ${provider.id}`);
    this.#providers.set(provider.id, provider);
  }

  route(role: ModelRole, providerId: string): void {
    if (!this.#providers.has(providerId)) throw new Error(`provider_not_found: ${providerId}`);
    this.#routing.set(role, providerId);
  }

  providerIds(): readonly string[] { return [...this.#providers.keys()]; }

  routedProvider(role: ModelRole): string | undefined { return this.#routing.get(role); }

  resolve(role: ModelRole): ModelClient | undefined {
    const providerId = this.#routing.get(role);
    return providerId ? this.#providers.get(providerId)?.client : undefined;
  }

  async health(providerId: string, signal: AbortSignal): Promise<ProviderHealth> {
    const provider = this.#providers.get(providerId);
    if (!provider) return "unknown";
    try { return await provider.health(signal); } catch { return "unavailable"; }
  }
}
