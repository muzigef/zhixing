import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { AgentService } from "../src/agent-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { AgentExecutionStore } from "../src/agent-execution-store.js";
import { CliAgentTransport } from "../src/cli-agent-transport.js";
import { emptyConversation } from "../src/conversation-session.js";
import { LearningApplication } from "../src/learning-application.js";
import { providerRuntime } from "../src/assistant-runtime.js";
import type { ContinuableModelClient } from "../src/model.js";

const roots: string[] = []; const apps: LearningApplication[] = [];
afterEach(async () => { apps.splice(0).forEach(app => app.close()); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
const topic = "agent-development";
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-contract-edges-")); roots.push(root);
  const app = await LearningApplication.open(root, process.cwd()); apps.push(app);
  await app.handle("开始第 1 天", topic);
  return { root, app };
}

it.each(["read", "no_context", "revoked"])("retains a queued %s restriction through stop and restart", async restriction => {
  const { root, app } = await fixture(); const store = new AgentSessionStore(path.join(root, "chats"));
  let ready!: () => void; const started = new Promise<void>(resolve => { ready = resolve; });
  const first = new AgentService(store, () => ({ async *stream(_prompt, signal) {
    ready(); await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })); signal.throwIfAborted(); yield { type: "done" as const };
  } }), app);
  const session = await first.create();
  const base = { sessionId: session.id, text: "当前问题", provider: "mock" as const, style: "adaptive" as const, topicId: topic };
  await first.send({ ...base, contextAllowed: true, execution: "session" }); await started;
  await first.enqueue({ ...base, text: "排队的独立请求", ...(restriction === "read" ? { execution: "read" as const } : { contextAllowed: false }) });
  first.stop(); await first.idle();
  const client: ContinuableModelClient = {
    async *stream() { yield { type: "tool_call", tool: "save_artifact", input: { dayId: "D01", kind: "implementation", text: "export const answer = 42;" }, callId: "save" }; yield { type: "done" }; },
    async *continue() { yield { type: "text_delta", text: "当前请求已处理。" }; yield { type: "done" }; },
  };
  const second = new AgentService(new AgentSessionStore(store.root), () => client, app);
  if (restriction === "revoked") await second.updatePermissions(session.id, { materials: false, project: false, external: false }, true);
  await second.resumeQueue(session.id); await second.idle();
  const saved = await second.load(session.id);
  expect((await app.evidence.list(topic, "D01")).artifacts).toHaveLength(0);
  if (restriction === "read") { expect(saved.executionAllowed).toBe(false); expect(saved.messages.at(-1)?.status).toBe("waiting"); }
  else expect(saved.contextAllowed).toBe(false);
});

it("cancels a resumed CLI application task through its caller signal without reporting success", async () => {
  const { root, app } = await fixture(); let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; }); let observedAbort = false;
  const client: ContinuableModelClient = {
    async *stream() { yield { type: "tool_call", tool: "ask_user", input: { title: "使用什么例子？" }, callId: "question" }; yield { type: "done" }; },
    async *continue(_prompt, _results, signal) {
      ready(); await new Promise<void>(resolve => { const timer = setTimeout(resolve, 100); signal.addEventListener("abort", () => { observedAbort = true; clearTimeout(timer); resolve(); }, { once: true }); });
      signal.throwIfAborted(); yield { type: "text_delta", text: "不应完成的回复" }; yield { type: "done" };
    },
  };
  const fallback = { runtime: providerRuntime("mock", client), request: { role: "tutor" as const, providerId: "mock", prompt: "合成请求", containsUserMaterials: false, confirmed: false } };
  const transport = new CliAgentTransport(root, app, () => client, async () => fallback, () => undefined);
  const chat = emptyConversation(topic, "chat"); await transport.ensure(chat);
  await transport.service.send({ sessionId: chat.id, text: "/agent 合成任务", provider: "mock", style: "adaptive" }); await transport.service.idle();
  const waiting = (await transport.service.load(chat.id)).messages.at(-1)!;
  // Model continuation after the saved question is resolved, without starting the next run.
  new AgentExecutionStore(app.database, { taskId: waiting.taskId!, sessionId: chat.id, topicId: topic }).decide("question", "数组", "once");
  const controller = new AbortController();
  const pending = transport.invoke(chat, { text: "继续", provider: "mock", style: "adaptive" }, { ...fallback, signal: controller.signal });
  const outcome = pending.then(value => ({ value, error: undefined }), error => ({ value: undefined, error }));
  await started; controller.abort();
  const result = await outcome;
  expect(observedAbort).toBe(true); expect(result.error).toMatchObject({ name: "AbortError" });
  expect((await transport.service.load(chat.id)).messages.at(-1)).toMatchObject({ taskId: waiting.taskId, status: "interrupted" });
});

it.each(["ready", "executing"] as const)("applies a durable steering request before dispatching old pending tools in %s state", async phase => {
  const { root, app } = await fixture(); const store = new AgentSessionStore(path.join(root, "chats"));
  const session = await store.create(); const taskId = crypto.randomUUID(); const steerId = crypto.randomUUID();
  session.topicId = topic; session.contextAllowed = true; session.executionAllowed = true; session.workspaceId = app.summary().id;
  session.messages.push({ id: crypto.randomUUID(), role: "assistant", text: "", taskId, status: "interrupted", profile: "application", createdAt: new Date().toISOString(), items: [{ id: crypto.randomUUID(), callId: "obsolete", kind: "approval", tool: "save_artifact", input: {}, title: "旧操作", status: "pending" }] });
  await store.save(session);
  const journal = new AgentExecutionStore(app.database, { taskId, sessionId: session.id, topicId: topic });
  const release = journal.claim();
  journal.save({ version: 1, status: "interrupted", prompt: "旧任务", containsMaterials: true, history: [], decisions: {}, pending: {
    events: [{ type: "tool_call", tool: "learning_progress", input: {}, callId: "known" }, { type: "tool_call", tool: "save_artifact", input: { dayId: "D01", kind: "implementation", text: "export const obsolete = true;" }, callId: "obsolete" }], toolResults: [{ tool: "learning_progress", callId: "known", result: { ok: true, output: "已记录的进度" } }], next: 1, phase,
  } }, "fixture"); release();
  let result: unknown;
  const client: ContinuableModelClient = {
    async *stream() { throw new Error("must retain native history"); yield { type: "done" }; },
    async *continue(_prompt, results) { expect(results[0]?.result).toEqual({ ok: true, output: "已记录的进度" }); result = results[1]?.result; yield { type: "text_delta", text: "按新要求只做解释。" }; yield { type: "done" }; },
  };
  const service = new AgentService(store, () => client, app);
  const request = { sessionId: session.id, text: "不要保存，改为只解释", provider: "mock" as const, style: "adaptive" as const, resumeTaskId: taskId, steerId };
  await service.send(request); await service.idle();
  expect((await app.evidence.list(topic, "D01")).artifacts).toHaveLength(0);
  expect(result).toMatchObject({ ok: false, errorCode: phase === "ready" ? "tool_superseded" : "tool_interrupted", outcome: phase === "ready" ? "not_started" : "unknown" });
  expect((await service.load(session.id)).messages.at(-1)).toMatchObject({ taskId, status: "completed" });
  expect((await service.load(session.id)).messages[0]?.items?.[0]).toMatchObject({ status: "answered" });
});
