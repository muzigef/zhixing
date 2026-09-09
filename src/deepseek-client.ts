import { ChatCompletionsClient, type FetchLike } from "./chat-completions-client.js";
import type { SecretStore } from "./secret-store.js";
export type { FetchLike } from "./chat-completions-client.js";

/** DeepSeek wire policy over the shared bounded API transport. */
export class DeepSeekClient extends ChatCompletionsClient {
  constructor(secrets: SecretStore, fetcher: FetchLike = fetch, environment: NodeJS.ProcessEnv = process.env,
    model = environment.ZHIXING_DEEPSEEK_MODEL ?? "deepseek-v4-flash",
    endpoint = "https://api.deepseek.com/v1/chat/completions", timeoutMs = 60_000) {
    super(secrets, fetcher, environment, model, endpoint, timeoutMs, "deepseek");
  }
}
