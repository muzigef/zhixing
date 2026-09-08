import { DeepSeekClient, type FetchLike } from "./deepseek-client.js";
import type { PiApplicationClient } from "./pi-application-client.js";
import type { SecretStore } from "./secret-store.js";
import type { ModelClient } from "./model.js";
import type { ContextBudget } from "./context-window.js";
import { environmentContextBudget, withModelBudget } from "./model-capabilities.js";

/** Hosts supply I/O and settings; model capability and budget policy live here. */
export function createAgentModel(provider: "pi-codex" | "deepseek-api", options: {
  pi: PiApplicationClient; secrets: SecretStore; fetcher?: FetchLike; environment?: NodeJS.ProcessEnv;
  deepseekModel?: string; contextBudget?: ContextBudget;
}): ModelClient {
  const environment = options.environment ?? process.env;
  return withModelBudget(provider === "pi-codex" ? options.pi : new DeepSeekClient(options.secrets, options.fetcher, environment, options.deepseekModel),
    options.contextBudget ?? environmentContextBudget(environment));
}
