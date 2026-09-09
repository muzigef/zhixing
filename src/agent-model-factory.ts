import { ChatCompletionsClient } from "./chat-completions-client.js";
import { isCustomProvider, type ApiConnection, type CustomProvider } from "./api-connection-config.js";
import { checkedConnection } from "./api-connections.js";
import { DeepSeekClient, type FetchLike } from "./deepseek-client.js";
import { KimiClient } from "./kimi-client.js";
import type { PiApplicationClient } from "./pi-application-client.js";
import type { SecretStore } from "./secret-store.js";
import type { ModelClient } from "./model.js";
import type { ContextBudget } from "./context-window.js";
import { environmentContextBudget, withModelBudget } from "./model-capabilities.js";

/** Hosts supply I/O and settings; model capability and budget policy live here. */
export function createAgentModel(provider: "pi-codex" | "deepseek-api" | "kimi-api" | CustomProvider, options: {
  pi: PiApplicationClient; secrets: SecretStore; fetcher?: FetchLike; environment?: NodeJS.ProcessEnv;
  connection?: ApiConnection; deepseekModel?: string; contextBudget?: ContextBudget;
}): ModelClient {
  const environment = options.environment ?? process.env;
  let client: ModelClient;
  if (provider === "pi-codex") client = options.pi;
  else if (provider === "deepseek-api") client = new DeepSeekClient(options.secrets, options.fetcher, environment, options.deepseekModel);
  else if (provider === "kimi-api") client = new KimiClient(options.secrets, options.fetcher, environment);
  else if (isCustomProvider(provider) && options.connection?.id === provider) {
    const connection = checkedConnection(options.connection);
    client = new ChatCompletionsClient(options.secrets, options.fetcher ?? fetch, environment, connection.model, `${connection.baseUrl}/chat/completions`, 150_000, "compatible", connection);
    const requested = options.contextBudget ?? environmentContextBudget(environment);
    const windowTokens = Math.min(requested?.windowTokens ?? connection.contextWindow, connection.contextWindow);
    return withModelBudget(client, { windowTokens, reserveOutputTokens: Math.min(requested?.reserveOutputTokens ?? connection.maxOutputTokens, connection.maxOutputTokens, Math.floor(windowTokens / 2)) });
  } else throw new Error("provider_not_found");
  return withModelBudget(client, options.contextBudget ?? environmentContextBudget(environment));
}
