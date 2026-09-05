import { describe, expect, it } from "vitest";
import { DeepSeekClient } from "../src/deepseek-client.js";
import { MemorySecretStore } from "../src/secret-store.js";
import { MockModelClient } from "../src/model.js";
import { collectInvocation } from "../src/model-invocation.js";
import { ProviderRegistry } from "../src/provider-registry.js";
import { ProviderRuntime } from "../src/provider-runtime.js";

describe("real adapter tool continuation with local fixtures", () => {
  it("assembles split arguments, preserves call IDs and all prior turns", async () => {
    const secrets = new MemorySecretStore(); await secrets.set("keychain:zhixing/deepseek-api", "fixture-key");
    const requests: Array<{ messages: Array<Record<string, unknown>>; tools: unknown[] }> = [];
    const client = new DeepSeekClient(secrets, async (_url, init) => {
      requests.push(JSON.parse(String(init.body)));
      if (requests.length === 3) return new Response(JSON.stringify({ choices: [{ message: { content: "verified answer" }, finish_reason: "stop" }] }));
      const index = requests.length;
      const frames = [
        { choices: [{ delta: { tool_calls: [{ index: 0, id: `lookup-${index}`, function: { name: "lookup", arguments: '{"query":' } }] } }] },
        { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: `"q${index}"}` } }] }, finish_reason: "tool_calls" }] },
      ];
      return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\r\n\r\n`).join("") + "data: [DONE]\r\n\r\n", { headers: { "content-type": "text/event-stream" } });
    }, { ZHIXING_ALLOW_LIVE_PROVIDER: "1" });
    const registry = new ProviderRegistry(); registry.register({ id: "deepseek-api", client, health: async () => "healthy" }); registry.route("tutor", "deepseek-api");
    const calls: unknown[] = [];
    const result = await collectInvocation(new ProviderRuntime(registry, new MockModelClient()), {
      role: "tutor", providerId: "deepseek-api", prompt: "use evidence", containsUserMaterials: true, confirmed: true, allowFallback: false,
      tools: [{ name: "lookup", description: "find evidence", inputSchema: { type: "object", properties: { query: { type: "string" } } } }],
      onToolCall: async (_name, input) => { calls.push(input); return { ok: true, evidence: calls.length }; },
    }, new AbortController().signal);
    expect(result.text).toBe("verified answer");
    expect(calls).toEqual([{ query: "q1" }, { query: "q2" }]);
    expect(requests[0]?.tools).toHaveLength(1);
    expect(requests[2]?.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool", "assistant", "tool"]);
    expect(requests[2]?.messages[2]).toMatchObject({ tool_call_id: "lookup-1", content: '{"ok":true,"evidence":1}' });
    expect(requests[2]?.messages[4]).toMatchObject({ tool_call_id: "lookup-2", content: '{"ok":true,"evidence":2}' });
  });
});
