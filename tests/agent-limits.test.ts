import { describe, expect, it } from "vitest";
import { MockModelClient, type ModelClient } from "../src/model.js";
import { ProviderRegistry } from "../src/provider-registry.js";
import { ProviderRuntime } from "../src/provider-runtime.js";
import { collectInvocation } from "../src/model-invocation.js";

const request = { role: "tutor" as const, providerId: "test", prompt: "safe", containsUserMaterials: false, confirmed: false, allowFallback: false };
function runtime(client: ModelClient): ProviderRuntime {
  const registry = new ProviderRegistry(); registry.register({ id: "test", client, health: async () => "healthy" }); registry.route("tutor", "test");
  return new ProviderRuntime(registry, new MockModelClient());
}
describe("agent resource budgets", () => {
  it("does not even construct another provider request after the turn limit", async () => {
    let continued = 0;
    const client = {
      async *stream() { yield { type: "tool_call" as const, tool: "lookup", input: {} }; },
      continue() { continued += 1; return this.stream(); },
    };
    await expect(collectInvocation(runtime(client), { ...request, limits: { maxTurns: 1 }, onToolCall: async () => "ok" }, new AbortController().signal)).rejects.toThrow("max_turns");
    expect(continued).toBe(0);
  });
  it("bounds text even when every individual delta is small", async () => {
    const providers = runtime({ async *stream() { for (let i = 0; i < 20; i += 1) yield { type: "text_delta", text: "xx" }; } });
    await expect(collectInvocation(providers, { ...request, limits: { maxOutputChars: 10 } }, new AbortController().signal)).rejects.toThrow("model_output_limit");
  });
  it("rejects too many distinct tool calls before executing the batch", async () => {
    let executed = 0;
    const providers = runtime({ async *stream() { for (let i = 0; i < 3; i += 1) yield { type: "tool_call", tool: "lookup", input: { i } }; } });
    await expect(collectInvocation(providers, { ...request, limits: { maxToolCalls: 2 }, onToolCall: async () => { executed += 1; } }, new AbortController().signal)).rejects.toThrow("max_tool_calls");
    expect(executed).toBe(0);
  });
  it("releases a stalled provider at the invocation deadline", async () => {
    const providers = runtime({ stream: () => ({ [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => undefined) }) }) });
    const result = collectInvocation(providers, { ...request, limits: { timeoutMs: 10 } }, new AbortController().signal);
    await expect(Promise.race([result.catch((error: Error) => error.message), new Promise((resolve) => setTimeout(() => resolve("hung"), 150))])).resolves.toContain("invocation_timeout");
  });
  it("labels a tool-only answer from a text-only adapter incomplete", async () => {
    const providers = runtime({ async *stream() { yield { type: "tool_call", tool: "lookup", input: {} }; } });
    await expect(collectInvocation(providers, { ...request, onToolCall: async () => "result" }, new AbortController().signal)).resolves.toMatchObject({ partial: true, stopReason: "provider_continuation_unsupported" });
  });
});
