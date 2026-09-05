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
    const client: ContinuableModelClient = { async *stream() { if (++turn === 1) { yield { type: "text_delta", text: "准备保存实现。" }; yield { type: "tool_call", tool: "save_artifact", input: { dayId: "D01", kind: "implementation", text: "export const answer = 42;" }, callId: "save1" }; } else yield { type: "text_delta", text: "实现已保存。" }; yield { type: "done" }; }, async *continue() { throw new Error("must pause for approval"); yield { type: "done" }; } };
    const store = new DesktopStore(path.join(root, "desktop")); const service = new DesktopService(store, () => client, app); const session = await service.create();
    await service.send({ sessionId: session.id, text: "保存示例", topicId: "agent-development", contextAllowed: true, provider: "deepseek-api", style: "adaptive" }); await service.idle();
    const message = (await service.load(session.id)).messages.at(-1)!;
    expect(message.status).toBe("waiting"); expect(message.text).not.toContain("准备保存");
    const item = message.items?.find((item) => item.kind === "approval"); expect(item?.status).toBe("pending");
    expect((await app.evidence.list("agent-development", "D01")).artifacts).toHaveLength(0);
    await service.answerInteraction(session.id, item!.id, "allow", "once"); await service.idle();
    const saved = await store.load(session.id);
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
