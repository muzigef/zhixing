import { expect, it } from "vitest";
import { collectInvocation } from "../src/model-invocation.js";
import { providerRuntime } from "../src/assistant-runtime.js";
import { effectiveModelBudget, capabilitiesFor, piReportedUsage } from "../src/model-capabilities.js";
import { DeepSeekClient } from "../src/deepseek-client.js";
import { MemorySecretStore } from "../src/secret-store.js";
import type { ModelRequestOptions } from "../src/model.js";

it("advertises application adapter capabilities and does not invent image support", async () => {
  let calls = 0; const client = { async *stream() { calls++; yield { type: "done" as const }; } };
  expect(capabilitiesFor(client)).toMatchObject({ inputModalities: ["text"], toolCalling: false, source: "adapter_policy" });
  await expect(collectInvocation(providerRuntime("mock", client), { role: "tutor", providerId: "mock", prompt: "image", containsUserMaterials: false, confirmed: false, inputModalities: ["image"] }, new AbortController().signal)).rejects.toThrow("provider_modality_unsupported");
  expect(calls).toBe(0);
  expect(() => effectiveModelBudget(client, { windowTokens: 100_000, reserveOutputTokens: 16_384 })).toThrow("context_budget_invalid");
});
it("forwards configured output reservation to the actual API request", async () => {
  const secrets = new MemorySecretStore(); await secrets.set("keychain:zhixing/deepseek-api", "synthetic-key"); let body: { max_tokens: number } | undefined;
  const client = new DeepSeekClient(secrets, async (_url, options) => { body = JSON.parse(options.body as string); return new Response(JSON.stringify({ choices: [{ message: { content: "完成" }, finish_reason: "stop" }] })); }, {});
  await collectInvocation(providerRuntime("deepseek-api", client), { role: "tutor", providerId: "deepseek-api", prompt: "合成", containsUserMaterials: false, confirmed: false, contextBudget: { windowTokens: 8000, reserveOutputTokens: 1024 } }, new AbortController().signal);
  expect(body?.max_tokens).toBe(1024);
});
it("uses reported input to increase next-turn estimates without raising the allowed window", async () => {
  const usages: import("../src/context-window.js").ContextUsage[] = []; let optionsSeen: ModelRequestOptions | undefined;
  const client = { async *stream() { yield { type: "usage" as const, usage: { inputTokens: 500, outputTokens: 3 } }; yield { type: "tool_call" as const, tool: "read", input: {}, callId: "one" }; yield { type: "done" as const }; }, async *continue(_prompt: string, _results: readonly unknown[], _signal: AbortSignal, options?: ModelRequestOptions) { optionsSeen = options; yield { type: "text_delta" as const, text: "完成" }; yield { type: "done" as const }; } };
  await collectInvocation(providerRuntime("mock", client), { role: "tutor", providerId: "mock", prompt: "短输入", containsUserMaterials: false, confirmed: false, onToolCall: async () => ({ ok: true }), onContext: usage => usages.push(usage), contextBudget: { windowTokens: 8000, reserveOutputTokens: 1024 } }, new AbortController().signal);
  expect(usages.at(-1)?.estimateMultiplier).toBeGreaterThan(1); expect(usages.at(-1)?.windowTokens).toBe(8000); expect(optionsSeen?.maxOutputTokens).toBe(1024);
});
it("normalizes Pi's disjoint input/cache counters to the same total-input contract as DeepSeek", () => {
  expect(piReportedUsage({ input: 10, cacheRead: 80, cacheWrite: 5, output: 4, reasoning: 2 })).toEqual({ inputTokens: 95, cacheReadTokens: 80, outputTokens: 4, reasoningTokens: 2 });
});
