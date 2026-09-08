import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { AgentService } from "../src/agent-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
it("returns the requested answer rather than a later queued reply, with truthful statistics", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-reply-"));
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; }); let calls = 0;
  const client = { async *stream() { const n = ++calls; if (n === 1) { started(); await gate; } yield { type: "text_delta" as const, text: `回答 ${n}` }; yield { type: "done" as const }; } };
  const service = new AgentService(new AgentSessionStore(root), () => client); const session = await service.create();
  cleanups.push(async () => { release(); service.stop(); await service.idle(); await service.pauseMaintenance(); await fs.rm(root, { recursive: true, force: true }); });
  const request = { sessionId: session.id, text: "第一个问题", provider: "mock" as const, style: "adaptive" as const };
  const reply = service.invoke(request); await ready;
  await service.enqueue({ ...request, text: "第二个问题" }); release();
  const result = await reply;
  expect(result.text).toBe("回答 1");
  expect(result.statistics).toMatchObject({ modelTurns: 1, toolCalls: 0, eventCount: null });
  expect(result).not.toHaveProperty("events", 0);
  expect(result).not.toHaveProperty("toolResults");
});

it("finishes a blocking invocation when its own answer settles, while a queued task is still running", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-reply-own-task-"));
  let firstReady!: () => void, nextReady!: () => void, release!: () => void;
  const first = new Promise<void>(resolve => { firstReady = resolve; }), next = new Promise<void>(resolve => { nextReady = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  const service = new AgentService(new AgentSessionStore(root), () => ({ async *stream(_prompt, signal) {
    if (++calls === 1) { firstReady(); await gate; yield { type: "text_delta" as const, text: "本次完成" }; }
    else { nextReady(); await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })); signal.throwIfAborted(); }
    yield { type: "done" as const };
  } }));
  cleanups.push(async () => { release(); service.stop(); await service.idle(); await service.pauseMaintenance(); await fs.rm(root, { recursive: true, force: true }); });
  const session = await service.create(), request = { sessionId: session.id, text: "本次问题", provider: "mock" as const, style: "adaptive" as const };
  const reply = service.invoke(request); await first; await service.enqueue({ ...request, text: "后续长任务" }); release(); await next;
  let timer: NodeJS.Timeout | undefined;
  try { expect(await Promise.race([reply.then(result => result.text), new Promise<string>(resolve => { timer = setTimeout(() => resolve("still_waiting"), 1000); })])).toBe("本次完成"); }
  finally { clearTimeout(timer); service.stop(); await reply.catch(() => undefined); }
});
it("uses the segmented-history capacity consistently when enqueueing after 1000 messages", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-long-queue-"));
  let ready!: () => void; const started = new Promise<void>(resolve => { ready = resolve; });
  const service = new AgentService(new AgentSessionStore(root), () => ({ async *stream(_prompt, signal) { ready(); await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })); signal.throwIfAborted(); yield { type: "done" as const }; } }));
  cleanups.push(async () => { service.stop(); await service.idle(); await service.pauseMaintenance(); await fs.rm(root, { recursive: true, force: true }); });
  const session = await service.create(); session.messages = Array.from({ length: 1000 }, (_, index) => ({ id: crypto.randomUUID(), role: "user", text: `原文 ${index}`, status: "completed", createdAt: session.createdAt })); await service.store.save(session);
  const request = { sessionId: session.id, text: "继续", provider: "mock" as const, style: "adaptive" as const };
  await service.send(request); await started;
  expect((await service.enqueue({ ...request, text: "接着分析" })).pendingRequests).toHaveLength(1);
  service.stop(); await service.idle();
  expect((await new AgentService(service.store, () => { throw new Error("must_not_run_on_restart"); }).load(session.id)).queuePaused).toBe(true);
});
