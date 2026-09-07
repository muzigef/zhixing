import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { DesktopStore } from "../desktop/core/store.js";
import { DesktopService } from "../desktop/core/service.js";
import { LearningApplication } from "../src/learning-application.js";
import type { ContinuableModelClient } from "../src/model.js";

it("persists a reviewable approval, executes only the approved input, then resumes the same task", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-interaction-")); const app = await LearningApplication.open(root, process.cwd());
  try {
    await app.handle("开始第 1 天", "agent-development"); let turn = 0;
    const client: ContinuableModelClient = { async *stream() { if (++turn === 1) { yield { type: "text_delta", text: "准备保存实现。" }; yield { type: "tool_call", tool: "save_artifact", input: { dayId: "D01", kind: "implementation", text: "export const answer = 42;" }, callId: "save1" }; } else yield { type: "text_delta", text: "实现已保存。" }; yield { type: "done" }; }, async *continue(_prompt, results, _signal, options) { expect(results[0]?.callId).toBe("save1"); expect(options?.history?.[0]?.toolResults).toHaveLength(1); yield { type: "text_delta", text: "实现已保存。" }; yield { type: "done" }; } };
    const store = new DesktopStore(path.join(root, "desktop")); const service = new DesktopService(store, () => client, app); const session = await service.create();
    await service.send({ sessionId: session.id, text: "保存示例", topicId: "agent-development", contextAllowed: true, provider: "deepseek-api", style: "adaptive" }); await service.idle();
    const message = (await service.load(session.id)).messages.at(-1)!;
    expect(message.status).toBe("waiting"); expect(message.text).not.toContain("准备保存");
    const item = message.items?.find((item) => item.kind === "approval"); expect(item?.status).toBe("pending");
    expect((await app.evidence.list("agent-development", "D01")).artifacts).toHaveLength(0);
    await service.answerInteraction(session.id, item!.id, "allow", "once"); await service.idle();
    const saved = await store.load(session.id);
    expect(saved.messages.at(-1)?.status).toBe("completed"); expect(turn).toBe(1);
    expect(saved.messages.at(-1)?.taskId).toBe(message.taskId); expect(saved.executionAllowed).not.toBe(true);
    expect((await app.evidence.list("agent-development", "D01")).artifacts).toHaveLength(1);
    await expect(service.answerInteraction(session.id, item!.id, "allow", "once")).rejects.toThrow("interaction_resolved");
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
});
it("forks from an edited user message without future history, queued tasks, or inherited write permission", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-fork-"));
  try {
    const store = new DesktopStore(root); const service = new DesktopService(store, () => ({ async *stream() { yield { type: "text_delta", text: "答" }; yield { type: "done" }; } })); const session = await service.create();
    await service.send({ sessionId: session.id, text: "原始问题", provider: "demo", style: "adaptive", execution: "session" }); await service.idle();
    const original = await store.load(session.id);
    const fork = await service.fork(session.id, original.messages[0]!.id, true);
    expect(fork.messages).toHaveLength(0); expect(fork.executionAllowed).toBe(false);
    expect(fork.parent?.sessionId).toBe(session.id); expect((await store.load(session.id)).messages).toHaveLength(2);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
it("keeps a multi-tool batch across restarts and returns denial as a native result without executing it", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-batch-approval-")); const app = await LearningApplication.open(root, process.cwd());
  try {
    await app.handle("开始第 1 天", "agent-development"); let starts = 0;
    const client: ContinuableModelClient = {
      async *stream() { starts++; for (const value of [41, 42]) yield { type: "tool_call", tool: "save_artifact", input: { dayId: "D01", kind: "implementation", text: `export const answer = ${value};` }, callId: `save${value}` }; yield { type: "done" }; },
      async *continue(_prompt, results) { expect(results.map(result => result.callId)).toEqual(["save41", "save42"]); expect(results[0]?.result).toMatchObject({ ok: true }); expect(results[1]?.result).toMatchObject({ ok: false, errorCode: "tool_policy_denied" }); yield { type: "text_delta", text: "已保存第一份，第二份未授权。" }; yield { type: "done" }; },
    };
    const store = new DesktopStore(path.join(root, "desktop")); const first = new DesktopService(store, () => client, app); const session = await first.create();
    await first.send({ sessionId: session.id, text: "保存两份示例", topicId: "agent-development", contextAllowed: true, provider: "deepseek-api", style: "adaptive" }); await first.idle();
    const a = (await store.load(session.id)).messages.at(-1)!;
    const second = new DesktopService(store, () => client, app);
    await second.answerInteraction(session.id, a.items!.find(item => item.kind === "approval")!.id, "allow"); await second.idle();
    const b = (await store.load(session.id)).messages.at(-1)!;
    expect(b.status).toBe("waiting");
    const third = new DesktopService(store, () => client, app);
    await third.answerInteraction(session.id, b.items!.find(item => item.kind === "approval")!.id, "deny"); await third.idle();
    const c = (await store.load(session.id)).messages.at(-1)!;
    expect(c.taskId).toBe(a.taskId); expect(c.status).toBe("completed"); expect(starts).toBe(1);
    expect((await app.evidence.list("agent-development", "D01")).artifacts).toHaveLength(1);
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
});

it("offers same-task recovery when approval is saved but continuation cannot start", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-approval-start-failure-")); const app = await LearningApplication.open(root, process.cwd());
  try {
    await app.handle("开始第 1 天", "agent-development"); let unavailable = false; let starts = 0;
    const client: ContinuableModelClient = {
      async *stream() { starts++; yield { type: "tool_call", tool: "save_artifact", input: { dayId: "D01", kind: "implementation", text: "export const answer = 42;" }, callId: "save" }; yield { type: "done" }; },
      async *continue(_prompt, results) { expect(results[0]).toMatchObject({ callId: "save", result: { ok: true } }); yield { type: "text_delta", text: "实现已保存。" }; yield { type: "done" }; },
    };
    const store = new DesktopStore(path.join(root, "desktop"));
    const first = new DesktopService(store, () => { if (unavailable) throw new Error("provider_unavailable"); return client; }, app);
    const session = await first.create();
    const request = { sessionId: session.id, text: "保存合成实现", topicId: "agent-development", contextAllowed: true, provider: "deepseek-api" as const, style: "adaptive" as const };
    await first.send(request); await first.idle();
    const waiting = (await first.load(session.id)).messages.at(-1)!;
    unavailable = true;
    await expect(first.answerInteraction(session.id, waiting.items!.find(item => item.kind === "approval")!.id, "allow")).rejects.toThrow("provider_unavailable");
    const restarted = new DesktopService(new DesktopStore(store.root), () => client, app);
    const recovered = (await restarted.load(session.id)).messages.at(-1)!;
    expect(recovered.status).toBe("interrupted");
    expect(recovered.taskId).toBe(waiting.taskId);
    expect(recovered.items!.find(item => item.kind === "approval")).toMatchObject({ status: "answered", answer: "allow" });
    await restarted.send({ ...request, text: "继续", resumeTaskId: recovered.taskId }); await restarted.idle();
    expect((await restarted.load(session.id)).messages.at(-1)?.status).toBe("completed");
    expect(starts).toBe(1); expect((await app.evidence.list("agent-development", "D01")).artifacts).toHaveLength(1);
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
});

it("keeps approvals distinct when separate tasks reuse a provider call ID", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-approval-identity-")); const app = await LearningApplication.open(root, process.cwd());
  try {
    await app.handle("开始第 1 天", "agent-development"); let starts = 0;
    const client: ContinuableModelClient = {
      async *stream() { starts++; yield { type: "tool_call", tool: "save_artifact", input: { dayId: "D01", kind: "implementation", text: `export const answer = ${starts};` }, callId: "call_1" }; yield { type: "done" }; },
      async *continue() { yield { type: "text_delta", text: "已完成授权的保存。" }; yield { type: "done" }; },
    };
    const store = new DesktopStore(path.join(root, "desktop")); const service = new DesktopService(store, () => client, app); const session = await service.create();
    const request = { sessionId: session.id, text: "保存合成实现", topicId: "agent-development", contextAllowed: true, provider: "deepseek-api" as const, style: "adaptive" as const };
    await service.send(request); await service.idle();
    const first = (await service.load(session.id)).messages.at(-1)!;
    await service.send({ ...request, text: "另一个独立任务" }); await service.idle();
    const second = (await service.load(session.id)).messages.at(-1)!;
    const firstCard = first.items!.find(item => item.kind === "approval")!;
    const secondCard = second.items?.find(item => item.kind === "approval");
    expect(secondCard).toBeDefined(); expect(secondCard!.id).not.toBe(firstCard.id);
    await service.answerInteraction(session.id, secondCard!.id, "allow"); await service.idle();
    const artifacts = (await app.evidence.list("agent-development", "D01")).artifacts;
    expect(artifacts).toHaveLength(1); expect(await app.evidence.content("agent-development", "D01", artifacts[0]!.id)).toBe("export const answer = 2;");
    expect((await service.load(session.id)).messages.find(message => message.id === first.id)!.items!.find(item => item.id === firstCard.id)).toMatchObject({ status: "pending" });
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
});
