import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopService } from "../desktop/core/service.js";
import { DesktopStore } from "../desktop/core/store.js";
import type { ModelClient } from "../src/model.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
async function fixture(client: ModelClient) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-tasks-")); roots.push(root);
  const store = new DesktopStore(root); const service = new DesktopService(store, () => client); const session = await service.create();
  const request = { sessionId: session.id, provider: "demo" as const, style: "adaptive" as const, text: "目标：理解检索，使用中文" };
  return { root, store, service, session, request };
}
function controlledClient() {
  const prompts: string[] = [];
  let release!: () => void;
  let started!: () => void;
  const first = new Promise<void>((resolve) => { started = resolve; });
  const client: ModelClient = { async *stream(prompt, signal) {
    prompts.push(prompt);
    yield { type: "text_delta", text: "回答片段" };
    if (prompts.length === 1) {
      started();
      await new Promise<void>((resolve) => { release = resolve; signal.addEventListener("abort", () => resolve(), { once: true }); });
      signal.throwIfAborted();
    }
    yield { type: "done" };
  } };
  return { client, prompts, first, release: () => release() };
}
describe("desktop task controls", () => {
  it("persists queued input, executes it in order, and includes the completed preceding answer", async () => {
    const provider = controlledClient(); const { store, service, request, session } = await fixture(provider.client);
    await service.send(request); await provider.first;
    await service.enqueue({ ...request, text: "再解释一个例子" });
    expect((await store.load(session.id)).pendingRequests).toHaveLength(1);
    provider.release(); await service.idle();
    const saved = await store.load(session.id);
    expect(saved.messages).toHaveLength(4);
    expect(saved.pendingRequests).toHaveLength(0);
    expect(provider.prompts[1]).toContain("再解释一个例子");
    expect(provider.prompts[1]).toContain("回答片段");
  });
  it("interrupts the old generation when steering and preserves the original task goal", async () => {
    const provider = controlledClient(); const { store, service, request, session } = await fixture(provider.client);
    await service.send(request); await provider.first;
    await service.enqueue({ ...request, text: "改用数据库检索的例子" }, true);
    await service.idle();
    const saved = await store.load(session.id);
    expect(saved.messages[1]?.status).toBe("interrupted");
    expect(saved.messages.at(-1)?.status).toBe("completed");
    expect(provider.prompts[1]).toContain("理解检索");
    expect(provider.prompts[1]).toContain("改用数据库检索");
  });
  it("stops the queue, restores it paused after restart, and resumes only on user action", async () => {
    const provider = controlledClient(); const { root, store, service, request, session } = await fixture(provider.client);
    await service.send(request); await provider.first;
    await service.enqueue({ ...request, text: "暂停后继续的问题" });
    service.stop(); await service.idle();
    expect(provider.prompts).toHaveLength(1);
    const restored = new DesktopService(new DesktopStore(root), () => provider.client);
    expect((await restored.load(session.id)).pendingRequests).toHaveLength(1);
    expect(restored.activeSessionId).toBeNull();
    await restored.resumeQueue(session.id); await restored.idle();
    expect((await store.load(session.id)).messages.at(-1)?.status).toBe("completed");
    expect(provider.prompts).toHaveLength(2);
  });
  it("retains an explicit goal and constraints across model switches and rejects active-task edits", async () => {
    const provider = controlledClient(); const { store, service, request, session } = await fixture(provider.client);
    await service.updateContext(session.id, "比较两种检索方案", "先结论后例子，保留来源");
    await service.send(request); await provider.first;
    await expect(service.updateContext(session.id, "other", "")).rejects.toThrow("run_active");
    provider.release(); await service.idle();
    await service.send({ ...request, text: "继续", provider: "pi-codex" }); await service.idle();
    expect(provider.prompts[1]).toContain("比较两种检索方案");
    expect(provider.prompts[1]).toContain("先结论后例子");
    expect((await store.load(session.id)).context?.goal).toBe("比较两种检索方案");
  });
});

it("keeps full history while compacting old turns and preserves explicit constraints", async () => {
  const prompts: string[] = [];
  const client: ModelClient = { async *stream(prompt) { prompts.push(prompt); yield { type: "text_delta", text: prompt.startsWith("请整理") ? "已经完成检索对比，尚待验证召回。" : "继续核对召回。" }; yield { type: "done" }; } };
  const { store, service, session, request } = await fixture(client);
  session.context = { goal: "最终交付检索对比", notes: "必须使用可验证引用" };
  for (let i = 0; i < 20; i++) session.messages.push({ id: crypto.randomUUID(), role: i % 2 ? "assistant" : "user", text: `历史 ${i}`, status: "completed", createdAt: new Date().toISOString() });
  await store.save(session); await service.send(request); await service.idle();
  await service.idleMaintenance();
  const saved = await store.load(session.id);
  expect(saved.messages).toHaveLength(22); expect(saved.context?.summary).toContain("尚待验证");
  expect(prompts).toHaveLength(2); expect(prompts[0]).toContain("必须使用可验证引用"); expect(prompts[0]).toContain("最终交付");
  expect(prompts[0]).toContain("历史 19"); expect(prompts[1]).toMatch(/^请整理/);
});
it("finishes the visible answer before a slow background compaction and cancels maintenance on the next turn", async () => {
  let started!: () => void; const compacting = new Promise<void>((resolve) => { started = resolve; });
  const client: ModelClient = { async *stream(prompt, signal) {
    if (prompt.startsWith("请整理")) { started(); await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })); signal.throwIfAborted(); }
    yield { type: "text_delta", text: "即时回答" }; yield { type: "done" };
  } };
  const { service, store, session, request } = await fixture(client);
  for (let i = 0; i < 20; i++) session.messages.push({ id: crypto.randomUUID(), role: i % 2 ? "assistant" : "user", text: `旧消息 ${i}`, status: "completed", createdAt: new Date().toISOString() });
  await store.save(session); await service.send(request); await service.idle(); await compacting;
  expect((await store.load(session.id)).messages.at(-1)?.status).toBe("completed");
  expect(service.activeSessionId).toBeNull(); service.stop(); await service.idleMaintenance();
});
it("pauses after an incomplete provider stream and allows withdrawing pending input", async () => {
  const provider = controlledClient(); const { store, service, session, request } = await fixture(provider.client);
  await service.send(request); await provider.first;
  await service.enqueue({ ...request, text: "撤回的问题" });
  const id = (await store.load(session.id)).pendingRequests![0]!.id;
  await service.withdraw(session.id, id); expect((await store.load(session.id)).pendingRequests).toHaveLength(0);
  provider.release(); await service.idle();
  const incomplete = new DesktopService(store, () => ({ async *stream() { yield { type: "text_delta", text: "断开的片段" }; } }));
  await incomplete.send(request); await incomplete.idle();
  expect((await store.load(session.id)).messages.at(-1)?.status).toBe("failed");
});
it("does not execute a queued request whose persistence failed", async () => {
  const provider = controlledClient(); const { service, store, request, session } = await fixture(provider.client);
  await service.send(request); await provider.first;
  const save = store.save.bind(store); let rejectOnce = true;
  store.save = async (value) => { if (rejectOnce) { rejectOnce = false; throw new Error("disk full"); } await save(value); };
  await expect(service.enqueue({ ...request, text: "不得执行的未保存消息" })).rejects.toThrow("disk full");
  provider.release(); await service.idle();
  expect(provider.prompts).toHaveLength(1); expect((await store.load(session.id)).pendingRequests).toHaveLength(0);
});
