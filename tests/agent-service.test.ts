import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { AgentService } from "../src/agent-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { DesktopService } from "../desktop/core/service.js";
import { LearningApplication } from "../src/learning-application.js";
import type { ContinuableModelClient } from "../src/model.js";

it.each((["session", "delta", "settled"] as const).flatMap(type => [{ type, asynchronous: false }, { type, asynchronous: true }]))("isolates a broken $type subscriber (async: $asynchronous) and keeps the session reusable", async ({ type: failedEvent, asynchronous }) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-observer-failure-"));
  const app = await LearningApplication.open(root, process.cwd());
  const store = new AgentSessionStore(path.join(root, "chats"));
  const client = { async *stream() { yield { type: "text_delta" as const, text: "正常回答" }; yield { type: "done" as const }; } };
  const service = new AgentService(store, () => client, app);
  const seen: string[] = [];
  service.subscribe(event => {
    if (event.type !== failedEvent) return;
    if (asynchronous) return Promise.reject(new Error("synthetic disconnected frontend"));
    throw new Error("synthetic disconnected frontend");
  });
  service.subscribe(event => { seen.push(event.type); });
  try {
    const session = await service.create();
    const request = { sessionId: session.id, text: "合成问题", provider: "mock" as const, style: "adaptive" as const };
    await service.send(request); await service.idle();
    expect((await store.load(session.id)).messages.at(-1)).toMatchObject({ text: "正常回答", status: "completed" });
    expect((await store.load(session.id)).messages.at(-1)?.contextUsage?.estimatedInputTokens).toBeGreaterThan(0);
    expect(service.activeSessionId).toBeNull(); expect(seen).toContain(failedEvent); expect(seen).toContain("settled");
    await service.send(request); await service.idle();
    const other = new AgentService(new AgentSessionStore(store.root), () => client, app);
    await other.send(request); await other.idle(); await other.pauseMaintenance();
    expect((await store.load(session.id)).messages).toHaveLength(6);
  } finally { service.stop(); await service.pauseMaintenance(); app.close(); await fs.rm(root, { recursive: true, force: true }); }
});

it("uses one headless lifecycle for a CLI invocation and desktop approval continuation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-shared-service-"));
  const app = await LearningApplication.open(root, process.cwd());
  try {
    expect(DesktopService).toBe(AgentService);
    const store = new AgentSessionStore(path.join(root, "sessions")); let starts = 0;
    const client: ContinuableModelClient = {
      async *stream() { starts++; yield { type: "tool_call", tool: "ask_user", input: { title: "使用哪个例子？" }, callId: "question" }; yield { type: "done" }; },
      async *continue(_prompt, results) { expect(results[0]?.callId).toBe("question"); expect(JSON.stringify(results)).toContain("数组"); yield { type: "text_delta", text: "使用数组例子。" }; yield { type: "done" }; },
    };
    const cli = new AgentService(store, () => client, app); const session = await cli.create();
    await cli.send({ sessionId: session.id, provider: "deepseek-api", style: "adaptive", text: "解释这个算法" }); await cli.idle();
    const waiting = (await cli.load(session.id)).messages.at(-1)!;
    const card = waiting.items!.find(item => item.kind === "question")!;
    const desktop = new DesktopService(store, () => client, app);
    await desktop.answerInteraction(session.id, card.id, "数组"); await desktop.idle();
    const complete = (await desktop.load(session.id)).messages.at(-1)!;
    expect(complete.status).toBe("completed"); expect(complete.taskId).toBe(waiting.taskId); expect(starts).toBe(1);
    const another = await cli.create();
    const simple = { async *stream() { yield { type: "text_delta" as const, text: "CLI 回答" }; yield { type: "done" as const }; } };
    const output = await new AgentService(store, () => simple, app).invoke({ sessionId: another.id, provider: "mock", style: "adaptive", text: "合成问题" });
    expect(output.text).toBe("CLI 回答"); expect((await cli.load(another.id)).messages.at(-1)?.status).toBe("completed");
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
});

it("prevents a second frontend from overwriting an actively running session", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-session-lease-")); const app = await LearningApplication.open(root, process.cwd());
  try {
    const store = new AgentSessionStore(path.join(root, "chats"));
    let ready!: () => void; const started = new Promise<void>(resolve => { ready = resolve; });
    const first = new AgentService(store, () => ({ async *stream(_prompt, signal) { ready(); await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })); signal.throwIfAborted(); yield { type: "done" as const }; } }), app);
    const second = new AgentService(store, () => ({ async *stream() { yield { type: "text_delta" as const, text: "后续回答" }; yield { type: "done" as const }; } }), app);
    const session = await first.create(); const request = { sessionId: session.id, provider: "mock" as const, style: "adaptive" as const, text: "问题" };
    await first.send(request); await started;
    await expect(second.rename(session.id, "不应覆盖运行中记录")).rejects.toThrow("session_in_use");
    await expect(second.updateContext(session.id, "新目标", "")).rejects.toThrow("session_in_use");
    await expect(second.withdraw(session.id, crypto.randomUUID())).rejects.toThrow("session_in_use");
    await expect(second.resumeQueue(session.id)).rejects.toThrow("session_in_use");
    await expect(second.send(request)).rejects.toThrow("session_in_use");
    expect((await store.load(session.id)).messages).toHaveLength(2);
    first.stop(); await first.idle(); await second.send(request); await second.idle();
    expect((await store.load(session.id)).messages).toHaveLength(4);
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
});

it("does not let an old background summary overwrite a newer frontend turn", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-summary-lease-")); const app = await LearningApplication.open(root, process.cwd());
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let ready!: () => void; const compacting = new Promise<void>(resolve => { ready = resolve; });
  const store = new AgentSessionStore(path.join(root, "chats"));
  const first = new AgentService(store, () => ({ async *stream(prompt) {
    if (prompt.startsWith("请整理")) { ready(); await gate; }
    yield { type: "text_delta" as const, text: "第一入口回答或摘要" }; yield { type: "done" as const };
  } }), app);
  const second = new AgentService(new AgentSessionStore(store.root), () => ({ async *stream() { yield { type: "text_delta" as const, text: "第二入口最新回答" }; yield { type: "done" as const }; } }), app);
  try {
    const session = await first.create();
    for (let index = 0; index < 20; index++) session.messages.push({ id: crypto.randomUUID(), role: index % 2 ? "assistant" : "user", text: `合成历史 ${index}`, status: "completed", createdAt: new Date().toISOString() });
    await store.save(session);
    const request = { sessionId: session.id, text: "继续", provider: "mock" as const, style: "adaptive" as const };
    await first.send(request); await first.idle(); await compacting;
    await second.rename(session.id, "第二入口的新标题");
    await second.send(request); await second.idle(); await second.pauseMaintenance();
    release(); await first.idleMaintenance();
    const saved = await store.load(session.id);
    expect(saved.messages).toHaveLength(24); expect(saved.title).toBe("第二入口的新标题");
    expect(saved.messages.at(-1)?.text).toBe("第二入口最新回答");
  } finally { release(); await first.pauseMaintenance(); await second.pauseMaintenance(); app.close(); await fs.rm(root, { recursive: true, force: true }); }
});

it("settles safely when another frontend claims the session before its queue drains", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-queue-handoff-")); const app = await LearningApplication.open(root, process.cwd());
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let ready!: () => void; const firstStarted = new Promise<void>(resolve => { ready = resolve; });
  let secondReady!: () => void; const secondStarted = new Promise<void>(resolve => { secondReady = resolve; });
  const store = new AgentSessionStore(path.join(root, "chats"));
  const first = new AgentService(store, () => ({ async *stream() { ready(); await gate; yield { type: "text_delta" as const, text: "第一条回答" }; yield { type: "done" as const }; } }), app);
  const second = new AgentService(new AgentSessionStore(store.root), () => ({ async *stream(_prompt, signal) {
    secondReady(); await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener("abort", () => resolve(), { once: true }); }); signal.throwIfAborted(); yield { type: "done" as const };
  } }), app);
  let handoff: Promise<unknown> | undefined;
  try {
    const session = await first.create(); const request = { sessionId: session.id, text: "问题", provider: "mock" as const, style: "adaptive" as const };
    await first.send(request); await firstStarted;
    await first.enqueue({ ...request, text: "尚未开始的排队问题" });
    first.subscribe(event => { if (event.type === "settled" && !handoff) handoff = second.send({ ...request, text: "另一入口的新问题" }); });
    release();
    await expect(first.idle()).resolves.toBeUndefined();
    await handoff; await secondStarted;
    const running = await second.load(session.id);
    expect(running.messages.at(-1)?.status).toBe("running");
    expect(running.messages.at(-2)?.text).toBe("另一入口的新问题");
    expect(running.pendingRequests?.map(item => item.text)).toEqual(["尚未开始的排队问题"]);
  } finally { release(); await handoff; second.stop(); await second.idle(); await first.pauseMaintenance(); app.close(); await fs.rm(root, { recursive: true, force: true }); }
});

it("does not let headless display or telemetry failures change task completion", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-headless-observer-"));
  const app = await LearningApplication.open(root, process.cwd());
  const service = new AgentService(new AgentSessionStore(path.join(root, "chats")), () => ({ async *stream() { yield { type: "text_delta" as const, text: "应保存的完整回答" }; yield { type: "done" as const }; } }), app);
  try {
    const session = await service.create();
    await service.invoke({ sessionId: session.id, text: "合成问题", provider: "mock", style: "adaptive" }, {
      onText: () => { throw new Error("synthetic display failure"); },
      onAudit: async () => { throw new Error("synthetic telemetry failure"); },
    });
    expect((await service.load(session.id)).messages.at(-1)).toMatchObject({ status: "completed", text: "应保存的完整回答" });
  } finally { await service.pauseMaintenance(); app.close(); await fs.rm(root, { recursive: true, force: true }); }
});
