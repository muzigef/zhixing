import type { ModelClient, ModelEvent } from "./model.js";
import { assertLiveProviderAllowed } from "./provider-policy.js";
import type { SecretStore } from "./secret-store.js";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Minimal OpenAI-compatible DeepSeek client; user materials must not be passed without consent. */
export class DeepSeekClient implements ModelClient {
  constructor(
    private readonly secrets: SecretStore,
    private readonly fetcher: FetchLike = fetch,
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly model = "deepseek-chat",
    private readonly endpoint = "https://api.deepseek.com/v1/chat/completions",
  ) {}

  async *stream(prompt: string, signal: AbortSignal): AsyncIterable<ModelEvent> {
    assertLiveProviderAllowed(this.environment);
    const key = await this.secrets.get("keychain:zhixing/deepseek-api");
    if (!key) throw new Error("provider_unavailable: deepseek-api 未配置");
    const response = await this.fetcher(this.endpoint, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: this.model, messages: [{ role: "user", content: prompt }], stream: false }),
    });
    if (!response.ok) throw new Error(`provider_unavailable: deepseek HTTP ${response.status}`);
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = payload.choices?.[0]?.message?.content;
    if (!text) throw new Error("provider_unavailable: deepseek 空响应");
    yield { type: "text_delta", text };
    yield { type: "done" };
  }
}
