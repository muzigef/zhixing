import type { ModelClient, ModelRole } from "./model.js";
import type { AgentBackend, AgentExecutor } from "./agent-executor.js";

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
  readonly #agents = new Map<string, AgentExecutor>();

  register(provider: ProviderAdapter): void {
    if (this.#providers.has(provider.id) || this.#agents.has(provider.id)) throw new Error(`provider_duplicate: ${provider.id}`);
    this.#providers.set(provider.id, provider);
  }
  registerAgent(id: string, executor: AgentExecutor): void {
    if (this.#providers.has(id) || this.#agents.has(id)) throw new Error(`provider_duplicate: ${id}`);
    this.#agents.set(id, executor);
  }
  backend(id: string): AgentBackend | undefined { return this.#agents.get(id) ?? this.#providers.get(id)?.client; }

  route(role: ModelRole, providerId: string): void {
    if (!this.#providers.has(providerId) && !this.#agents.has(providerId)) throw new Error(`provider_not_found: ${providerId}`);
    this.#routing.set(role, providerId);
  }

  providerIds(): readonly string[] { return [...this.#providers.keys(), ...this.#agents.keys()]; }

  routedProvider(role: ModelRole): string | undefined { return this.#routing.get(role); }

  client(providerId: string): ModelClient | undefined { if (this.#agents.has(providerId)) throw new Error("native_agent_task_required"); return this.#providers.get(providerId)?.client; }

  resolve(role: ModelRole): ModelClient | undefined {
    const providerId = this.#routing.get(role);
    return providerId ? this.client(providerId) : undefined;
  }

  async health(providerId: string, signal: AbortSignal): Promise<ProviderHealth> {
    const provider = this.#providers.get(providerId);
    if (!provider) return "unknown";
    try { return await provider.health(signal); } catch { return "unavailable"; }
  }
}
