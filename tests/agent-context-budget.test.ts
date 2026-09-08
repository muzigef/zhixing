import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { excerpt } from "../src/conversation-context.js";
import { buildMessages } from "../src/learning-agent-profile.js";
import { collectInvocation } from "../src/model-invocation.js";
import { providerRuntime } from "../src/assistant-runtime.js";
import { AgentExecutionStore } from "../src/agent-execution-store.js";
import { ZhixingDatabase } from "../src/database.js";
import type { ChatSession } from "../src/agent-session-contracts.js";
import type { ContinuableModelClient, ModelTurn } from "../src/model.js";
import { modelContextWindow } from "../src/context-window.js";

it("keeps goals, constraints, latest answer and current input while removing older text", () => {
  const messages = [
    { role: "system" as const, content: "可信规则" }, { role: "user" as const, content: "最初目标" },
    ...Array.from({ length: 30 }, (_, index) => ({ role: index % 2 ? "assistant" as const : "user" as const, content: `旧记录${index}${"中文🙂".repeat(100)}` })),
    { role: "observation" as const, content: "关键约束：只讨论检索缓存" }, { role: "assistant" as const, content: "最新已显示的段落" }, { role: "user" as const, content: "当前纠正：改用数据库示例" },
  ];
  const original = JSON.stringify(messages);
  const view = modelContextWindow({ prompt: "fallback", messages, history: [] }, 1800, { windowTokens: 3000, reserveOutputTokens: 1000 });
  expect(view.usage.estimatedInputTokens + view.usage.reservedOutputTokens).toBeLessThanOrEqual(3000);
  expect(view.usage.chars).toBeLessThanOrEqual(1800); expect(view.usage.omittedMessages).toBeGreaterThan(0);
  for (const text of ["可信规则", "最初目标", "关键约束", "最新已显示", "当前纠正"]) expect(JSON.stringify(view.messages)).toContain(text);
  expect(JSON.stringify(messages)).toBe(original);
  expect(view.messages.at(-1)?.content).toBe("当前纠正：改用数据库示例");
});

it.each([0, 1, 4, 20, 45])("keeps tiny excerpts within %i characters without splitting a Unicode character", limit => {
  const result = excerpt("🙂中文".repeat(100), limit);
  expect(result.length).toBeLessThanOrEqual(limit);
  expect(result).not.toMatch(/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/);
});

it("retains an explicit correction after its conversation range has been summarized", () => {
  const now = new Date().toISOString(); const steerId = crypto.randomUUID();
  const session: ChatSession = { version: 3, id: crypto.randomUUID(), title: "合成", customTitle: false, createdAt: now, updatedAt: now,
    context: { goal: "讲解缓存", notes: "保留引用", summary: "旧摘要漏掉了纠正", summaryThroughId: "00000000-0000-4000-a000-000000000002" },
    messages: [
      { id: crypto.randomUUID(), role: "user", text: "纠正：这里的缓存只指检索结果", status: "completed", createdAt: now },
      { id: "00000000-0000-4000-a000-000000000002", role: "assistant", text: "收到", status: "completed", createdAt: now, steerId },
    ],
  };
  const messages = buildMessages(session, { sessionId: session.id, provider: "mock", style: "adaptive", text: "继续" });
  expect(messages.filter(message => message.role !== "system").map(message => message.content).join("\n")).toContain("这里的缓存只指检索结果");
  expect(messages.filter(message => message.role === "system").map(message => message.content).join("\n")).not.toContain("这里的缓存只指检索结果");
});

it("projects old complete tool turns into a bounded model window without changing the durable transcript", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-context-window-")); const db = new ZhixingDatabase(path.join(root, "db.sqlite"));
  try {
    const store = new AgentExecutionStore(db, { taskId: crypto.randomUUID(), sessionId: crypto.randomUUID(), topicId: "rag" });
    const history: ModelTurn[] = Array.from({ length: 20 }, (_, index) => ({ events: [{ type: "tool_call", tool: "read", input: { index }, callId: `c${index}` }], toolResults: [{ tool: "read", callId: `c${index}`, result: `原始结果 ${index} ${"长内容".repeat(100)}` }] }));
    const release = store.claim();
    store.save({ version: 1, status: "interrupted", prompt: "原始目标", containsMaterials: false, history, decisions: {} }, "fixture"); release();
    let selected: readonly ModelTurn[] = [];
    const client: ContinuableModelClient = { async *stream() { throw new Error("must continue"); yield { type: "done" }; }, async *continue(_prompt, results, _signal, options) {
      selected = options?.history ?? []; expect(results[0]?.callId).toBe("c19");
      for (const turn of selected) expect(turn.toolResults.map(result => result.callId)).toEqual(turn.events.filter(event => event.type === "tool_call").map(event => event.callId));
      yield { type: "text_delta", text: "完成" }; yield { type: "done" };
    } };
    const output = await collectInvocation(providerRuntime("fixture", client), { role: "tutor", providerId: "fixture", prompt: "继续", containsUserMaterials: false, confirmed: false, execution: store, limits: { maxContextChars: 1800 } }, new AbortController().signal);
    expect(output.finalText).toBe("完成"); expect(selected.length).toBeLessThan(20); expect(selected.at(-1)).toEqual(history.at(-1));
    expect(store.read()?.history.slice(0, 20)).toEqual(history);
  } finally { db.close(); await fs.rm(root, { recursive: true, force: true }); }
});

it("reserves output space and rejects oversized mandatory content before asking a model", async () => {
  let calls = 0;
  const client = { async *stream() { calls++; yield { type: "text_delta" as const, text: "不应调用" }; yield { type: "done" as const }; } };
  await expect(collectInvocation(providerRuntime("fixture", client), { role: "tutor", providerId: "fixture", prompt: "必须完整保留".repeat(500), containsUserMaterials: false, confirmed: false, contextBudget: { windowTokens: 1000, reserveOutputTokens: 400 } }, new AbortController().signal)).rejects.toThrow("model_input_limit");
  expect(calls).toBe(0);
});
