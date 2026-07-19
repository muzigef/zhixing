import { describe, expect, it } from "vitest";
import { DeepSeekClient } from "../src/deepseek-client.js";
import { MemorySecretStore } from "../src/secret-store.js";

async function collect(client: DeepSeekClient): Promise<string[]> {
  const output: string[] = [];
  for await (const event of client.stream("safe prompt", new AbortController().signal)) output.push(event.text ?? event.type);
  return output;
}

describe("DeepSeek client", () => {
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
    expect(String(request?.body)).toContain("deepseek-chat");
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
    await expect(collect(client)).rejects.toThrow("provider_unavailable: deepseek-api socket closed");
  });
});
