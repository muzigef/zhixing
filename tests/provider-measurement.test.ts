import { expect, it } from "vitest";
import { DeepSeekClient } from "../src/deepseek-client.js";
import { MemorySecretStore } from "../src/secret-store.js";
import { withModelBudget, resolveSdkBudget } from "../src/model-capabilities.js";
import { summarizePerformance } from "../desktop/core/diagnostics.js";
import type { ModelEvent } from "../src/model.js";
import type { ChatMessage } from "../src/agent-session-contracts.js";
it("preserves reported usage on truncated streams, distinguishes the cause, and never emits completion", async () => {
  const secrets = new MemorySecretStore(); await secrets.set("keychain:zhixing/deepseek-api", "synthetic");
  const body = 'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":4096}}\n\ndata: [DONE]\n\n';
  const client = new DeepSeekClient(secrets, async () => new Response(body, { headers: { "content-type": "text/event-stream" } }), {});
  const events: ModelEvent[] = [];
  await expect((async () => { for await (const event of client.stream("synthetic", new AbortController().signal)) events.push(event); })()).rejects.toThrow("provider_incomplete: length");
  expect(events.filter(event => event.type === "usage")).toEqual([{ type: "usage", usage: expect.objectContaining({ inputTokens: 12, outputTokens: 4096 }) }]);
  expect(events.some(event => event.type === "done" || event.type === "tool_call")).toBe(false);
});
it("keeps an explicitly configured client budget and clamps SDK limits before a network request", () => {
  const client = { contextBudget: { windowTokens: 8000, reserveOutputTokens: 1024 }, async *stream() { yield { type: "done" as const }; } };
  expect(withModelBudget(client).contextBudget).toEqual(client.contextBudget);
  expect(resolveSdkBudget({ contextWindow: 200_000, maxTokens: 32_000 }, 1024)).toEqual({ windowTokens: 48_000, reserveOutputTokens: 1024, providerContextWindow: 200_000, providerMaxOutput: 32_000 });
  expect(resolveSdkBudget({ contextWindow: 4096, maxTokens: 1024 }, 2048).reserveOutputTokens).toBe(1024);
  expect(() => resolveSdkBudget({ contextWindow: NaN, maxTokens: 1024 }, 1024)).toThrow("provider_capabilities_invalid");
});
it("measures DeepSeek request and first text using the same timing contract as Pi, with submitted reasoning", async () => {
  const secrets = new MemorySecretStore(); await secrets.set("keychain:zhixing/deepseek-api", "synthetic");
  const client = new DeepSeekClient(secrets, async () => new Response(JSON.stringify({ choices: [{ message: { content: "完成" }, finish_reason: "stop" }] })), {});
  const events: ModelEvent[] = []; for await (const event of client.stream("合成", new AbortController().signal, { reasoning: "deep", maxOutputTokens: 1024 })) events.push(event);
  const timing = events.find(event => event.type === "timing")?.timing;
  expect(timing).toMatchObject({ submittedReasoning: "high", outputTokenLimit: 1024, transport: "sse" });
  expect(timing?.firstTextMs).toBeGreaterThanOrEqual(0); expect(timing?.requestMs).toBeLessThanOrEqual(timing!.totalMs);
  expect(events.at(-1)?.type).toBe("done");
});
it("uses one completion timestamp so a clock tick cannot make request time exceed total time", async () => {
  const { vi } = await import("vitest");
  let calls = 0;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => Math.max(0, ++calls - 2));
  try {
    const secrets = new MemorySecretStore(); await secrets.set("keychain:zhixing/deepseek-api", "synthetic");
    const client = new DeepSeekClient(secrets, async () => new Response(JSON.stringify({ choices: [{ message: { content: "完成" }, finish_reason: "stop" }] })), {});
    for await (const event of client.stream("合成", new AbortController().signal)) if (event.type === "timing") expect(event.timing!.requestMs).toBeLessThanOrEqual(event.timing!.totalMs);
  } finally { clock.mockRestore(); }
});
it("separates different context sizes, turn counts, and Pi reasoning selections in performance comparisons", () => {
  const base: ChatMessage = { id: crypto.randomUUID(), role: "assistant", text: "合成", status: "completed", provider: "pi-codex", createdAt: new Date().toISOString(), reasoning: "balanced", model: "fixture", usage: { inputTokens: 100, outputTokens: 1 }, modelTimings: [{ transport: "sse", startupMs: 1, requestMs: 5, selectionMs: 0, totalMs: 6, processTailMs: 0, submittedReasoning: "low" }] };
  const moreInput = { ...base, usage: { inputTokens: 20_000, outputTokens: 1 } };
  const deeper = { ...base, modelTimings: [{ ...base.modelTimings![0]!, submittedReasoning: "high" }] };
  const moreTurns = { ...base, modelTimings: [...base.modelTimings!, ...base.modelTimings!] };
  expect(summarizePerformance([base, moreInput, deeper, moreTurns])[0]?.variants).toHaveLength(4);
});
