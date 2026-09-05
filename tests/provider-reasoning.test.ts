import { expect, it } from "vitest";
import { DeepSeekClient } from "../src/deepseek-client.js";
import { MemorySecretStore } from "../src/secret-store.js";
import { collectInvocation } from "../src/model-invocation.js";
import { providerRuntime } from "../src/assistant-runtime.js";

it("preserves opaque reasoning for tool continuation and reports usage without displaying reasoning", async () => {
  const secrets = new MemorySecretStore(); await secrets.set("keychain:zhixing/deepseek-api", "fixture-key");
  const requests: Record<string, unknown>[] = []; let visible = "";
  const client = new DeepSeekClient(secrets, async (_url, request) => { requests.push(JSON.parse(request.body as string));
    const first = requests.length === 1;
    return new Response(JSON.stringify({ choices: [{ message: first ? { reasoning_content: "private fixture reasoning", tool_calls: [{ id: "call1", type: "function", function: { name: "progress", arguments: "{}" } }] } : { reasoning_content: "private final reasoning", content: "完成" }, finish_reason: first ? "tool_calls" : "stop" }], usage: { prompt_tokens: 12, completion_tokens: 5, prompt_cache_hit_tokens: 4 } }), { headers: { "content-type": "application/json" } }); }, {});
  const usages: unknown[] = [];
  const result = await collectInvocation(providerRuntime("deepseek-api", client), { role: "tutor", providerId: "deepseek-api", prompt: "问", reasoning: "deep", containsUserMaterials: false, confirmed: true, tools: [{ name: "progress", description: "进度", inputSchema: { type: "object" } }], onToolCall: async () => ({ ok: true }), onText: (text) => { visible += text; }, onUsage: (usage) => usages.push(usage) }, new AbortController().signal);
  expect(result.text).toBe("完成"); expect(visible).not.toContain("private");
  expect(requests[0]).toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: "high" });
  expect(JSON.stringify(requests[1])).toContain("private fixture reasoning");
  expect(usages).toHaveLength(2); expect(usages[0]).toMatchObject({ inputTokens: 12, outputTokens: 5, cacheReadTokens: 4 });
});
it("accepts a long legitimate streamed answer whose transport metadata exceeds 256 KB", async () => {
  const secrets = new MemorySecretStore(); await secrets.set("keychain:zhixing/deepseek-api", "fixture-key");
  const frame = `data: ${JSON.stringify({ id: "metadata".repeat(40), choices: [{ delta: { content: "正文" } }] })}\n\n`;
  const body = frame.repeat(1600) + 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
  const client = new DeepSeekClient(secrets, async () => new Response(body, { headers: { "content-type": "text/event-stream" } }), {});
  let text = ""; for await (const event of client.stream("问题", new AbortController().signal, { reasoning: "quick" })) if (event.type === "text_delta") text += event.text;
  expect(text).toBe("正文".repeat(1600));
});
