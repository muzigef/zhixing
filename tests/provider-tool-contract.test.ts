import { afterEach, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { z } from "zod/v4";
import { ToolHarness } from "../src/tool-harness.js";
import { PiApplicationClient } from "../src/pi-application-client.js";
import { DeepSeekClient } from "../src/deepseek-client.js";
import { MemorySecretStore } from "../src/secret-store.js";
import { collectInvocation } from "../src/model-invocation.js";
import { providerRuntime } from "../src/assistant-runtime.js";
const cleanup: string[] = [];
afterEach(async () => { for (const root of cleanup.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function adapter(provider: string, truncated = false) {
  let round = 0; const requests: Record<string, unknown>[] = [];
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-provider-contract-")); cleanup.push(root);
  await fs.writeFile(path.join(root, "settings.json"), JSON.stringify({ defaultProvider: "openai-codex", defaultModel: "synthetic" }));
  const secrets = new MemorySecretStore(); await secrets.set("keychain:zhixing/deepseek-api", "synthetic-provider-contract");
  const next = () => { round++; return { callId: `call-${round}`, input: { value: round === 1 ? "invalid integer" : 7 } }; };
  const pi = new PiApplicationClient({ projectDir: root, executable: "node", worker: "synthetic-worker", sdk: "synthetic-sdk", environment: { PI_CODING_AGENT_DIR: root }, runner: async function* (request) {
    requests.push(JSON.parse(request.input)); const call = next();
    const events = round <= 2 ? [{ type: "tool_call", tool: "bounded", ...call }] : [{ type: "text_delta", text: "已核验合成结果。" }];
    yield { type: "stdout", data: Buffer.from([...events, ...(!truncated ? [{ type: "done" }] : [])].map(value => JSON.stringify(value)).join("\n") + "\n") };
    yield { type: "exit", code: 0 };
  } });
  const deepseek = new DeepSeekClient(secrets, async (_url, options) => {
    requests.push(JSON.parse(String(options.body))); const call = next();
    const delta = round <= 2 ? { tool_calls: [{ index: 0, id: call.callId, type: "function", function: { name: "bounded", arguments: JSON.stringify(call.input) } }] } : { content: "已核验合成结果。" };
    return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: round <= 2 ? "tool_calls" : "stop" }] })}\n\n${truncated ? "" : "data: [DONE]\n\n"}`, { headers: { "content-type": "text/event-stream" } });
  }, {});
  return { client: provider === "pi-codex" ? pi : deepseek, requests };
}
it.each(["pi-codex", "deepseek-api"])("%s preserves executable schemas, validation failures, call identities and output budgets across native continuation", async provider => {
  const { client, requests } = await adapter(provider); const harness = new ToolHarness(); let executed = 0;
  harness.register({ name: "bounded", description: "合成参数验证", input: z.object({ value: z.number().int().min(1).max(9) }).strict(), risk: "read", idempotent: true, timeoutMs: 1000, execute: async input => { executed++; return { value: input.value }; } });
  const result = await collectInvocation(providerRuntime(provider, client), { role: "tutor", providerId: provider, prompt: "合成调用", containsUserMaterials: false, confirmed: false, tools: harness.definitions(), contextBudget: { windowTokens: 8000, reserveOutputTokens: 1024 }, onToolCall: (tool, input, signal) => harness.execute(tool, input, { topicId: "rag", signal }) }, new AbortController().signal);
  expect(result.text).toBe("已核验合成结果。"); expect(executed).toBe(1); expect(requests).toHaveLength(3);
  if (provider === "pi-codex") {
    const wire = requests as unknown as { options: { tools: { inputSchema: unknown }[]; maxOutputTokens: number; history: { toolResults: unknown[] }[] } }[];
    expect(wire[0]!.options.tools[0]!.inputSchema).toEqual(harness.definitions()[0]!.inputSchema);
    expect(wire.every(request => request.options.maxOutputTokens === 1024)).toBe(true);
    expect(wire[1]!.options.history[0]!.toolResults[0]).toMatchObject({ callId: "call-1", result: { ok: false, errorCode: "tool_input_invalid" } });
  } else {
    const wire = requests as unknown as { tools: { function: { parameters: unknown } }[]; max_tokens: number; messages: { role: string }[] }[];
    expect(wire[0]!.tools[0]!.function.parameters).toEqual(harness.definitions()[0]!.inputSchema);
    expect(wire.every(request => request.max_tokens === 1024)).toBe(true);
    expect(wire[1]!.messages.find((message: { role: string }) => message.role === "tool")).toMatchObject({ tool_call_id: "call-1", content: expect.stringContaining("tool_input_invalid") });
  }
});
it.each(["pi-codex", "deepseek-api"])("%s does not execute a tool from a truncated native stream", async provider => {
  const { client } = await adapter(provider, true); let calls = 0;
  await expect(collectInvocation(providerRuntime(provider, client), { role: "tutor", providerId: provider, prompt: "合成断流", containsUserMaterials: false, confirmed: false, onToolCall: async () => { calls++; return {}; } }, new AbortController().signal)).rejects.toThrow("provider_incomplete");
  expect(calls).toBe(0);
});
