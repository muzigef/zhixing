import { describe, expect, it } from "vitest";
import { DeepSeekClient } from "../src/deepseek-client.js";
import { MemorySecretStore } from "../src/secret-store.js";

async function collect(client: DeepSeekClient): Promise<string[]> {
  const output: string[] = [];
  for await (const event of client.stream("safe prompt", new AbortController().signal)) output.push(event.text ?? event.type);
  return output;
}

describe("DeepSeek client", () => {
  it("默认纯本地模式拒绝请求", async () => {
    const client = new DeepSeekClient(new MemorySecretStore(), async () => new Response("", { status: 200 }), {});
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
  });
});
