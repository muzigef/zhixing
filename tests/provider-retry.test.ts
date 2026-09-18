import { afterEach, expect, it, vi } from "vitest";
import { fetchModelResponse } from "../src/provider-retry.js";
import { ChatCompletionsClient } from "../src/chat-completions-client.js";
import { ProtocolModelClient } from "../src/protocol-model-client.js";
import { apiConnectionInputSchema } from "../src/api-connection-config.js";
import { connectionIdentity } from "../src/api-connections.js";
import { MemorySecretStore } from "../src/secret-store.js";
import type { ModelEvent } from "../src/model.js";

afterEach(() => vi.useRealTimers());
const collect = async (stream: AsyncIterable<ModelEvent>) => { const out: ModelEvent[] = []; for await (const event of stream) out.push(event); return out; };
const init = () => ({ method: "POST", signal: new AbortController().signal, body: "synthetic" });
it("honors Retry-After, bounds attempts and reuses the exact request and deadline", async () => {
  vi.useFakeTimers(); const request = init();
  const fetcher = vi.fn(async () => new Response(null, { status: 429, headers: { "retry-after": "2" } }));
  const pending = fetchModelResponse(fetcher, "https://fixture.example", request, Date.now() + 10_000);
  await vi.advanceTimersByTimeAsync(1999); expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2001);
  expect((await pending).attempts).toBe(3); expect(fetcher).toHaveBeenCalledTimes(3);
  const sent = (fetcher.mock.calls[0] as unknown[])[1];
  expect(fetcher.mock.calls.every(call => (call as unknown[])[1] === sent)).toBe(true);
  expect(sent).toMatchObject({ body: request.body, method: "POST" });
});
it("does not shorten server backoff to force another attempt into the caller budget", async () => {
  const fetcher = vi.fn(async () => new Response(null, { status: 429, headers: { "retry-after": "3600" } }));
  expect((await fetchModelResponse(fetcher, "https://fixture.example", init(), Date.now() + 100)).attempts).toBe(1);
});
it("shares a single deadline across backoff and a stalled retry", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 429 })).mockImplementation(() => new Promise<Response>(() => {}));
  const pending = fetchModelResponse(fetcher, "https://fixture.example", init(), Date.now() + 600);
  const rejected = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
  await vi.advanceTimersByTimeAsync(600); await rejected;
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect((fetcher.mock.calls[1]![1] as RequestInit).signal?.aborted).toBe(true);
});
it("accepts an explicit service rejection with an HTTP-date backoff and never returns early", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-18T00:00:00Z"));
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503, headers: { "retry-after": "Fri, 18 Sep 2026 00:00:02 GMT" } })).mockResolvedValueOnce(new Response("answer"));
  const pending = fetchModelResponse(fetcher, "https://fixture.example", init(), Date.now() + 5000);
  await vi.advanceTimersByTimeAsync(1999); expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1); expect(await pending).toMatchObject({ attempts: 2, retryWaitMs: 2000 });
});
it.each([400, 401, 403, 408, 500, 502, 503, 504])("does not replay ambiguous or permanent HTTP %i failures", async status => {
  const fetcher = vi.fn(async () => new Response(null, { status }));
  await fetchModelResponse(fetcher, "https://fixture.example", init(), Date.now() + 10_000);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("does not replay transport failures and stops backoff immediately on cancellation", async () => {
  const broken = vi.fn(async () => { throw new Error("synthetic-network"); });
  await expect(fetchModelResponse(broken, "https://fixture.example", init(), Date.now() + 10_000)).rejects.toThrow("synthetic-network");
  expect(broken).toHaveBeenCalledTimes(1);
  const controller = new AbortController();
  const fetcher = vi.fn(async () => new Response(null, { status: 429, headers: { "retry-after": "20" } }));
  const pending = fetchModelResponse(fetcher, "https://fixture.example", { ...init(), signal: controller.signal }, Date.now() + 30_000);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); controller.abort();
  await expect(pending).rejects.toMatchObject({ name: "AbortError" }); expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(["openai-chat-completions", "openai-responses", "anthropic-messages"] as const)("integrates rejection retry into %s without replaying a malformed success", async protocol => {
  vi.useFakeTimers();
  const draft = apiConnectionInputSchema.parse({ name: "Retry fixture", protocol, baseUrl: "https://fixture.example/v1", model: "fixture-model" });
  const connection = { ...draft, id: connectionIdentity(draft) }, secrets = new MemorySecretStore();
  await secrets.set(`keychain:zhixing/${connection.id}`, "fixture-only");
  const payload = protocol === "anthropic-messages"
    ? { type: "message", role: "assistant", content: [{ type: "text", text: "answer" }], stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 2 } }
    : protocol === "openai-responses" ? { id: "r-fixture", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "answer" }] }], usage: { input_tokens: 3, output_tokens: 2 } }
      : { choices: [{ message: { content: "answer" }, finish_reason: "stop" }], usage: { prompt_tokens: 3, completion_tokens: 2 } };
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 429 })).mockImplementation(async () => new Response(JSON.stringify(payload)));
  const client = protocol === "openai-chat-completions"
    ? new ChatCompletionsClient(secrets, fetcher, {}, connection.model, `${connection.baseUrl}/chat/completions`, 10_000, "compatible", connection)
    : new ProtocolModelClient(connection, secrets, fetcher, {}, 10_000);
  const pending = collect(client.stream("synthetic", new AbortController().signal));
  await vi.advanceTimersByTimeAsync(1000); const result = await pending;
  expect(result.filter(event => event.type === "text_delta").map(event => event.text).join("")).toBe("answer");
  expect(result.find(event => event.type === "timing")?.timing).toMatchObject({ requestAttempts: 2 });
  expect(result.filter(event => event.type === "usage")).toHaveLength(1);
  fetcher.mockReset().mockImplementation(async () => new Response("malformed"));
  await expect(collect(client.stream("synthetic", new AbortController().signal))).rejects.toThrow("provider_protocol_error");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
