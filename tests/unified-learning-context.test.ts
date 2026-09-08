import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { LearningApplication } from "../src/learning-application.js";
import { LearningProfileStore } from "../src/learning-profile.js";
import { TeachingSessionStore } from "../src/teaching-session-store.js";
const apps: LearningApplication[] = [];
afterEach(async () => { for (const app of apps.splice(0)) { app.close(); await fs.rm(app.root, { recursive: true, force: true }); } });
it("recalls confirmed memories, profile and teaching checkpoint through the application boundary", async () => {
  const app = await LearningApplication.open(await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-unified-context-")), process.cwd()); apps.push(app);
  await new LearningProfileStore(app.paths).save("rag", { goal: "理解引用链", level: "初学", dailyMinutes: 30, totalDays: 7 });
  app.database.writeMemory("memory-rag", { topicId: "rag", type: "learning_fact", content: "回答需要可核对的引用", sourceKind: "user", sourceRef: "user", confidence: 1, confirmed: true });
  app.database.writeMemory("memory-other", { topicId: "3dgs", type: "learning_fact", content: "其他主题私有记忆", sourceKind: "user", sourceRef: "user", confidence: 1, confirmed: true });
  await new TeachingSessionStore(app.paths).save("rag", { dayId: "D01", dayCard: "引用链练习", stage: "practice", quizRound: 1, currentExercise: "如何判断引用支持结论？" });
  const signal = new AbortController().signal;
  const context = await app.context("rag", "帮我理解引用", true, signal);
  expect(context.text).toContain("理解引用链");
  expect(context.text).toContain("memory-rag");
  expect(context.text).toContain("回答需要可核对的引用");
  expect(context.text).toContain("如何判断引用支持结论？");
  expect(context.text).not.toContain("其他主题私有记忆");
  app.database.deleteMemory("rag", "memory-rag");
  const fresh = await app.context("rag", "帮我理解引用", true, signal);
  expect(fresh.text).not.toContain("回答需要可核对的引用");
  const revoked = await app.context("rag", "帮我理解引用", false, signal);
  expect(revoked.text).not.toContain("理解引用链");
  expect(revoked.text).not.toContain("如何判断引用支持结论？");
  expect(revoked.evidence).toEqual([]);
});

it("binds prerequisite course metadata to its own topic instead of the current day's title", async () => {
  const app = await LearningApplication.open(await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-prerequisite-context-")), process.cwd()); apps.push(app);
  app.database.writeMemory("private-other", { topicId: "agent-development", type: "learning_fact", content: "前置主题的私有学习记忆", sourceKind: "user", sourceRef: "user", confidence: 1, confirmed: true });
  const snapshot = await app.progressSnapshot("rag");
  expect(snapshot).toMatchObject({ prerequisiteCourses: [
    { topicId: "agent-development", dayId: "D01", title: "Agent 契约与状态边界", estimatedMinutes: 240 },
    { topicId: "agent-development", dayId: "D02", title: "受控工具与运行生命周期", estimatedMinutes: 240 },
  ] });
  const context = await app.context("rag", "检查我的进度，建议最小下一步", true, new AbortController().signal);
  const value = JSON.parse(context.text.slice(context.text.indexOf("\n") + 1));
  expect(value.course).toMatchObject({ topicId: "rag", id: "D01", title: "本地资料导入与引用" });
  expect(value.prerequisiteCourses).toEqual(snapshot.prerequisiteCourses);
  expect(context.text).not.toContain("前置主题的私有学习记忆");
});
