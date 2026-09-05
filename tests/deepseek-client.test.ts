import { describe, expect, it, vi } from "vitest";
import { DeepSeekClient } from "../src/deepseek-client.js";
import { MemorySecretStore } from "../src/secret-store.js";

async function collect(client: DeepSeekClient): Promise<string[]> {
  const output: string[] = [];
  for await (const event of client.stream("safe prompt", new AbortController().signal)) output.push(event.text ?? event.type);
  return output;
}

describe("DeepSeek client", () => {
  async function fixture(body: ReadableStream<Uint8Array>, timeoutMs = 100): Promise<DeepSeekClient> {
    const secrets = new MemorySecretStore(); await secrets.set("keychain:zhixing/deepseek-api", "fixture-deepseek-key");
    return new DeepSeekClient(secrets, async () => new Response(body, { headers: { "content-type": "text/event-stream" } }), { ZHIXING_ALLOW_LIVE_PROVIDER: "1" }, undefined, undefined, timeoutMs);
  }
  it("handles CRLF frames split across transport chunks", async () => {
    const source = 'data: {"choices":[{"delta":{"content":"你好"}}]}\r\n\r\ndata: [DONE]\r\n\r\n';
    const bytes = new TextEncoder().encode(source);
    const body = new ReadableStream<Uint8Array>({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
    await expect(collect(await fixture(body))).resolves.toEqual(["你好", "done"]);
  });
  it("stops and cancels the stream at DONE without waiting for EOF", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n')); }, cancel });
    const result = collect(await fixture(body));
    await expect(Promise.race([result, new Promise((resolve) => setTimeout(() => resolve("hung"), 200))])).resolves.toEqual(["ok", "done"]);
    expect(cancel).toHaveBeenCalled();
  });
  it("rejects truncated streams instead of reporting successful completion", async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n')); controller.close(); } });
    await expect(collect(await fixture(body))).rejects.toThrow("provider_incomplete");
  });
  it("rejects malformed data frames instead of silently losing model content", async () => {
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {invalid}\n\ndata: [DONE]\n\n')); controller.close(); } });
    await expect(collect(await fixture(body))).rejects.toThrow("provider_protocol_error");
  });
  it("enforces timeout even when a body ignores fetch cancellation", async () => {
    const body = new ReadableStream<Uint8Array>();
    const result = collect(await fixture(body, 10));
    await expect(Promise.race([result.catch((error: Error) => error.message), new Promise((resolve) => setTimeout(() => resolve("hung"), 200))])).resolves.toContain("provider_timeout");
  });
  it("does not access credentials or fetch when already cancelled", async () => {
    const secrets = new MemorySecretStore(); const get = vi.spyOn(secrets, "get"); const fetcher = vi.fn();
    const client = new DeepSeekClient(secrets, fetcher, { ZHIXING_ALLOW_LIVE_PROVIDER: "1" });
    const controller = new AbortController(); controller.abort();
    await expect(client.stream("safe", controller.signal)[Symbol.asyncIterator]().next()).rejects.toThrow("cancelled");
    expect(get).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("显式本地模式拒绝请求", async () => {
    const client = new DeepSeekClient(new MemorySecretStore(), async () => new Response("", { status: 200 }), { ZHIXING_ALLOW_LIVE_PROVIDER: "0" });
    await expect(collect(client)).rejects.toThrow("live_provider_disabled");
  });

  it("从 SecretStore 读取 Key，并以 OpenAI-compatible 请求调用 mock fetch", async () => {
    const secrets = new MemorySecretStore();
    await secrets.set("keychain:zhixing/deepseek-api", "fixture-deepseek-key");
    let request: RequestInit | undefined;
    const client = new DeepSeekClient(secrets, async (_url, init) => {
      request = init;
      return new Response(JSON.stringify({ choices: [{ message: { content: "mock reply" } }] }), { status: 200 });
    }, { ZHIXING_ALLOW_LIVE_PROVIDER: "1" });
    await expect(collect(client)).resolves.toEqual(["mock reply", "done"]);
    expect(request?.headers).toEqual(expect.objectContaining({ authorization: `Bearer ${"fixture-deepseek-key"}` }));
    expect(String(request?.body)).toContain("deepseek-v4-flash");
    expect(String(request?.body)).toContain('"stream":true');
  });

  it("转发 SSE delta，避免等待完整回答后才输出", async () => {
    const secrets = new MemorySecretStore();
    await secrets.set("keychain:zhixing/deepseek-api", "fixture-deepseek-key");
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"第"}}]}\n\ndata: {"choices":[{"delta":{"content":"一段"}}]}\n\ndata: [DONE]\n\n'));
        controller.close();
      },
    });
    const client = new DeepSeekClient(secrets, async () => new Response(body, { headers: { "content-type": "text/event-stream" } }), { ZHIXING_ALLOW_LIVE_PROVIDER: "1" });
    await expect(collect(client)).resolves.toEqual(["第", "一段", "done"]);
  });

  it("将网络失败规范化为可恢复的 provider_unavailable 错误", async () => {
    const secrets = new MemorySecretStore();
    await secrets.set("keychain:zhixing/deepseek-api", "fixture-deepseek-key");
    const client = new DeepSeekClient(secrets, async () => { throw new Error("socket closed"); }, { ZHIXING_ALLOW_LIVE_PROVIDER: "1" });
    await expect(collect(client)).rejects.toThrow("provider_unavailable: deepseek-api 请求或读取失败");
  });
});
