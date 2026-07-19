import type { ModelClient, ModelEvent } from "./model.js";
import { assertLiveProviderAllowed } from "./provider-policy.js";
import type { SecretStore } from "./secret-store.js";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
const MAX_SSE_BUFFER_BYTES = 64 * 1024;

/** Minimal OpenAI-compatible DeepSeek client; user materials must not be passed without consent. */
export class DeepSeekClient implements ModelClient {
  constructor(
    private readonly secrets: SecretStore,
    private readonly fetcher: FetchLike = fetch,
    private readonly environment: NodeJS.ProcessEnv = process.env,
    private readonly model = "deepseek-chat",
    private readonly endpoint = "https://api.deepseek.com/v1/chat/completions",
    private readonly timeoutMs = 60_000,
  ) {}

  async *stream(prompt: string, signal: AbortSignal): AsyncIterable<ModelEvent> {
    assertLiveProviderAllowed(this.environment);
    const key = await this.secrets.get("keychain:zhixing/deepseek-api");
    if (!key) throw new Error("provider_unavailable: deepseek-api 未配置");
    const timeout = AbortSignal.timeout(this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetcher(this.endpoint, {
        method: "POST",
        signal: AbortSignal.any([signal, timeout]),
        headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: this.model, messages: [{ role: "user", content: prompt }], stream: true }),
      });
    } catch (error) {
      if (signal.aborted) throw new DOMException("cancelled", "AbortError");
      if (timeout.aborted) throw new Error("provider_timeout: deepseek-api 请求超时");
      throw new Error(`provider_unavailable: deepseek-api ${error instanceof Error ? error.message.slice(0, 160) : "请求失败"}`);
    }
    if (!response.ok) throw new Error(`provider_unavailable: deepseek HTTP ${response.status}`);
    if (timeout.aborted) throw new Error("provider_timeout");
    if (response.body && response.headers.get("content-type")?.includes("text/event-stream")) {
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        for (;;) {
          const next = await reader.read();
          if (next.done) break;
          buffer += decoder.decode(next.value, { stream: true });
          if (buffer.length > MAX_SSE_BUFFER_BYTES) throw new Error("provider_output_limit: deepseek SSE frame exceeded limit");
          const events = buffer.split("\n\n"); buffer = events.pop() ?? "";
          for (const event of events) {
            const data = event.split("\n").find((line) => line.startsWith("data:"))?.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            try {
              const delta = (JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }> }).choices?.[0]?.delta?.content;
              if (delta) yield { type: "text_delta", text: delta };
            } catch { /* Ignore malformed SSE frames; the provider may send keepalives. */ }
          }
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
      if (timeout.aborted) throw new Error("provider_timeout");
      yield { type: "done" };
      return;
    }
    const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = payload.choices?.[0]?.message?.content;
    if (!text) throw new Error("provider_unavailable: deepseek 空响应");
    yield { type: "text_delta", text };
    yield { type: "done" };
  }
}
