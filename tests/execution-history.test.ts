import { expect, it } from "vitest";
import { ZhixingDatabase } from "../src/database.js";
import { AgentExecutionStore } from "../src/agent-execution-store.js";
import { readExecutionHistory, attachConversationHistory } from "../src/execution-history.js";
import { ToolHarness } from "../src/tool-harness.js";
import { collectInvocation } from "../src/model-invocation.js";
import { providerRuntime } from "../src/assistant-runtime.js";

it("pages exact original execution text with version checks and task/session scope", () => {
  const db = new ZhixingDatabase(":memory:");
  try {
    const identity = { taskId: crypto.randomUUID(), sessionId: crypto.randomUUID(), topicId: "rag" }; const store = new AgentExecutionStore(db, identity); const release = store.claim();
    const original = "原始回复🙂".repeat(1000);
    store.save({ version: 1, status: "interrupted", prompt: "合成", containsMaterials: true, decisions: {}, history: [{ events: [{ type: "text_delta", text: original }], toolResults: [] }] }, "fixture"); release();
    let page = readExecutionHistory(store, { turn: 0, offset: 0 }, true); let text = page.content;
    while (page.nextOffset !== null) { page = readExecutionHistory(store, { turn: 0, offset: page.nextOffset, expectedHash: page.contentHash }, true); text += page.content; }
    expect(JSON.parse(text).events[0].text).toBe(original);
    expect(() => readExecutionHistory(store, { turn: 0, offset: 1, expectedHash: "a".repeat(64) }, true)).toThrow("history_version_mismatch");
    expect(() => readExecutionHistory(store, { turn: 0, offset: 0 }, false)).toThrow("execution_context_required");
    expect(() => readExecutionHistory(new AgentExecutionStore(db, { ...identity, sessionId: crypto.randomUUID() }), { turn: 0, offset: 0 }, true)).toThrow("execution_scope_mismatch");
  } finally { db.close(); }
});
it("replaces stale observations only in the model view and preserves the canonical transcript", async () => {
  const db = new ZhixingDatabase(":memory:");
  try {
    const store = new AgentExecutionStore(db, { taskId: crypto.randomUUID(), sessionId: crypto.randomUUID(), topicId: "rag" }); const release = store.claim();
    const messages = [{ role: "system" as const, content: "规则" }, { role: "observation" as const, content: "已经撤回的旧学习记录" }, { role: "user" as const, content: "原始问题" }];
    store.save({ version: 1, status: "interrupted", prompt: "合成", messages, containsMaterials: true, decisions: {}, history: [] }, "fixture"); release();
    let selected: ModelRequestOptions | undefined;
    const client = { async *stream(_prompt: string, _signal: AbortSignal, options?: ModelRequestOptions) { selected = options; yield { type: "text_delta" as const, text: "新回复" }; yield { type: "done" as const }; } };
    await collectInvocation(providerRuntime("mock", client), { role: "tutor", providerId: "mock", prompt: "合成", containsUserMaterials: true, confirmed: true, materialContext: true, execution: store, freshObservations: [{ role: "observation", content: "当前未观察到该知识点记录" }] }, new AbortController().signal);
    expect(JSON.stringify(selected?.messages)).not.toContain("已经撤回"); expect(JSON.stringify(selected?.messages)).toContain("当前未观察到"); expect(store.read()?.messages).toEqual(messages);
  } finally { db.close(); }
});
import type { ModelRequestOptions } from "../src/model.js";

it("reads only the service-supplied conversation and denies model-selected foreign sessions", async () => {
  const id = crypto.randomUUID();
  const tools = attachConversationHistory({ harness: new ToolHarness(), definitions: [] }, [{ id, role: "user", text: "最初的数组问题", status: "completed", createdAt: new Date().toISOString() }]);
  const context = { topicId: "rag", signal: new AbortController().signal };
  const result = await tools.harness.execute("read_conversation_history", { message: 0 }, context);
  expect(result).toMatchObject({ ok: true, output: { messageId: id, content: expect.stringContaining("最初的数组问题"), nextMessage: null } });
  expect(await tools.harness.execute("read_conversation_history", { message: 0, sessionId: crypto.randomUUID() }, context)).toMatchObject({ ok: false, errorCode: "tool_input_invalid" });
});
