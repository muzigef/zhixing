import { ChatCompletionsClient, type FetchLike } from "./chat-completions-client.js";
import type { SecretStore } from "./secret-store.js";

/** Mainland Kimi API; always-on reasoning and native continuation are provider policies. */
export class KimiClient extends ChatCompletionsClient {
  constructor(secrets: SecretStore, fetcher: FetchLike = fetch, environment: NodeJS.ProcessEnv = process.env, timeoutMs = 150_000) {
    super(secrets, fetcher, environment, "kimi-k3", "https://api.moonshot.cn/v1/chat/completions", timeoutMs, "kimi");
  }
}
