import { expect, it, vi } from "vitest";
import { KimiClient } from "../src/kimi-client.js";
import { MemorySecretStore } from "../src/secret-store.js";
import type { ModelClient, ModelEvent } from "../src/model.js";

async function collect(client: ModelClient, options?: Parameters<ModelClient["stream"]>[2]) {
  const events: ModelEvent[] = [];
  for await (const event of client.stream("合成问题", new AbortController().signal, options)) events.push(event);
  return events;
}
async function credentials() {
  const secrets = new MemorySecretStore();
  await secrets.set("keychain:zhixing/deepseek-api", "fixture-deepseek-only");
  await secrets.set("keychain:zhixing/kimi-api", "fixture-kimi-only");
  return secrets;
}
it.each([["quick", "low"], ["balanced", "high"], ["deep", "max"]] as const)("Kimi maps %s to %s without disabling thinking or using DeepSeek credentials", async (reasoning, effort) => {
  const secrets = await credentials(); const get = vi.spyOn(secrets, "get");
  const client = new KimiClient(secrets, async (url, request) => {
    expect(url).toBe("https://api.moonshot.cn/v1/chat/completions");
    expect(request.headers).toMatchObject({ authorization: `Bearer ${"fixture-kimi-only"}` });
    const body = JSON.parse(String(request.body));
    expect(body).toMatchObject({ model: "kimi-k3", reasoning_effort: effort, max_tokens: 1024, stream: true });
    expect(body.thinking).toBeUndefined();
    return new Response('data: {"choices":[{"delta":{"reasoning_content":"private fixture"}}]}\r\n\r\ndata: {"choices":[{"delta":{"content":"完成"},"finish_reason":"stop"}]}\r\n\r\ndata: {"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":3,"prompt_tokens_details":{"cached_tokens":2}}}\r\n\r\ndata: [DONE]\r\n\r\n', { headers: { "content-type": "text/event-stream" } });
  }, {});
  const events = await collect(client, { reasoning, maxOutputTokens: 1024 });
  expect(get).toHaveBeenCalledExactlyOnceWith("keychain:zhixing/kimi-api");
  expect(events.filter(event => event.type === "text_delta")).toEqual([{ type: "text_delta", text: "完成" }]);
  expect(events.find(event => event.type === "usage")?.usage).toMatchObject({ model: "kimi-k3", cacheReadTokens: 2 });
  expect(events.find(event => event.type === "timing")?.timing?.submittedReasoning).toBe(effort);
});
it("preserves Kimi's reasoning and exact tool arguments for quick-mode continuation", async () => {
  const requests: { messages: Record<string, unknown>[] }[] = [];
  const client = new KimiClient(await credentials(), async (_url, request) => {
    requests.push(JSON.parse(String(request.body)));
    return new Response(JSON.stringify({ choices: [{ message: requests.length === 1 ? { content: "先核对", reasoning_content: "private fixture", tool_calls: [{ id: "call-1", type: "function", function: { name: "progress", arguments: '{ "topic": "rag" }' } }] } : { content: "完成" }, finish_reason: requests.length === 1 ? "tool_calls" : "stop" }] }));
  }, {});
  const events = await collect(client, { reasoning: "quick" });
  const toolResults = [{ tool: "progress", callId: "call-1", result: { ok: true } }];
  for await (const event of client.continue("合成问题", toolResults, new AbortController().signal, { reasoning: "quick", history: [{ events, toolResults }] })) expect(event).toBeDefined();
  expect(requests[1]!.messages[1]).toEqual({ role: "assistant", content: "先核对", reasoning_content: "private fixture", tool_calls: [{ id: "call-1", type: "function", function: { name: "progress", arguments: '{ "topic": "rag" }' } }] });
  expect(requests[1]!.messages[2]).toMatchObject({ role: "tool", tool_call_id: "call-1" });
});
it("does not use a DeepSeek key when Kimi is unconfigured", async () => {
  const secrets = new MemorySecretStore(); await secrets.set("keychain:zhixing/deepseek-api", "fixture-other-key");
  const fetcher = vi.fn();
  await expect(collect(new KimiClient(secrets, fetcher, {}))).rejects.toThrow("kimi-api 未配置");
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([401, 402, 403, 429, 500])("exposes only status for Kimi HTTP %s", async status => {
  await expect(collect(new KimiClient(await credentials(), async () => new Response("sensitive provider response", { status }), {}))).rejects.toThrow(`provider_unavailable: kimi HTTP ${status}`);
});
it("redacts network errors and obeys the offline gate before reading credentials", async () => {
  const secrets = await credentials(); const get = vi.spyOn(secrets, "get"); const fetcher = vi.fn(async () => { throw new Error("sensitive request"); });
  await expect(collect(new KimiClient(secrets, fetcher, { ZHIXING_ALLOW_LIVE_PROVIDER: "0" }))).rejects.toThrow("live_provider_disabled");
  expect(get).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  await expect(collect(new KimiClient(secrets, fetcher, {}))).rejects.toThrow("provider_unavailable: kimi-api 请求或读取失败");
});
