import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { AgentService } from "../src/agent-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { LearningApplication } from "../src/learning-application.js";
const cleanups: (() => Promise<void>)[] = []; afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
it("keeps each conversation's exercise independent and prevents forked answers from grading the parent exercise", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-teaching-isolation-")); const app = await LearningApplication.open(root, process.cwd());
  const prompts: string[] = []; const service = new AgentService(new AgentSessionStore(path.join(root, "chats")), () => ({ async *stream(prompt) { prompts.push(prompt); yield { type: "text_delta" as const, text: "新问题：依据是什么？" }; yield { type: "done" as const }; } }), app);
  cleanups.push(async () => { service.stop(); await service.idle(); await service.pauseMaintenance(); app.close(); await fs.rm(root, { recursive: true, force: true }); });
  const one = await service.create(), two = await service.create();
  for (const [session, text] of [[one, "练习 A"], [two, "练习 B"]] as const) {
    session.topicId = "rag"; session.mode = "lesson"; session.contextAllowed = true;
    session.teaching = { topicId: "rag", dayCard: "合成学习卡", stage: "practice", quizRound: 1, transcript: [], learnerAttempts: [], currentExercise: text, updatedAt: session.updatedAt };
    await service.store.save(session);
  }
  await service.invoke({ sessionId: one.id, text: "我的答案是引用需支持结论", provider: "mock", style: "adaptive" });
  expect(prompts[0]).toContain("练习 A"); expect(prompts[0]).not.toContain("练习 B");
  expect((await service.load(two.id)).teaching?.learnerAttempts).toEqual([]);
  expect((await service.load(one.id)).teaching?.learnerAttempts).toHaveLength(1);
  const fork = await service.fork(one.id); prompts.length = 0;
  await service.invoke({ sessionId: fork.id, text: "我的答案是另一个判断", provider: "mock", style: "adaptive", contextAllowed: true });
  expect((await service.load(fork.id)).teaching).toBeNull();
  expect((await service.load(one.id)).teaching?.learnerAttempts).toHaveLength(1);
  expect(await app.teaching.load("rag")).toBeUndefined();
  const fresh = await service.create(); const before = prompts.length;
  const reply = await service.invoke({ sessionId: fresh.id, text: "开始任务", provider: "mock", style: "adaptive", topicId: "agent-development", contextAllowed: true });
  expect(reply.text).toContain("当前没有进行中的学习日"); expect(prompts).toHaveLength(before);
  expect((await service.load(fresh.id)).teaching).toBeNull();
});
