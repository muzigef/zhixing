import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { LearningApplication } from "../src/learning-application.js";
import { CliAgentTransport } from "../src/cli-agent-transport.js";
import { DesktopService } from "../desktop/core/service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { emptyConversation } from "../src/conversation-session.js";
import type { ContinuableModelClient, ModelRequestOptions } from "../src/model.js";
const apps: LearningApplication[] = [];
afterEach(async () => { for (const app of apps.splice(0)) { app.close(); await fs.rm(app.root, { recursive: true, force: true }); } });

it.each(["chat", "lesson"] as const)("keeps model inputs, recall tools and background summaries identical for %s", async mode => {
  const app = await LearningApplication.open(await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-unified-policy-")), process.cwd()); apps.push(app);
  const topic = "agent-development";
  await app.profiles.save(topic, { goal: "掌握工具回读", level: "初学", dailyMinutes: 30, totalDays: 7 });
  app.database.writeMemory("fixture-memory", { topicId: topic, type: "learning_fact", content: "请用数组例子", sourceKind: "user", sourceRef: "user", confidence: 1, confirmed: true });
  if (mode === "lesson") await app.teaching.save(topic, { dayId: "D01", dayCard: "工具回读学习卡", stage: "practice", quizRound: 1, currentExercise: "工具失败后如何恢复？" });
  const calls: Array<{ prompt: string; options?: ModelRequestOptions }> = [];
  const client: ContinuableModelClient = {
    async *stream(prompt, _signal, options) { calls.push(structuredClone({ prompt, options })); yield { type: "text_delta", text: prompt.startsWith("请整理") ? "已讲解数组示例，等待下一步。" : "可以根据历史中的实际结果继续解释。" }; yield { type: "done" }; },
    async *continue() { throw new Error("fixture_unexpected_continue"); yield { type: "done" }; },
  };
  const cli = new CliAgentTransport(app.root, app, () => client, () => undefined);
  const chat = emptyConversation(topic, mode);
  const base = await cli.ensure(chat); base.contextAllowed = true; base.context = { goal: "理解工具回读", notes: "用中文" };
  for (let i = 0; i < 28; i++) base.messages.push({ id: crypto.randomUUID(), role: i % 2 ? "assistant" : "user", text: `可回读的完整原文 ${i}`, status: "completed", createdAt: base.createdAt });
  await cli.service.store.save(base);
  const desktopStore = new AgentSessionStore(path.join(app.root, "desktop-synthetic")); await desktopStore.save(structuredClone(base));
  const request = { text: "请解释一下恢复流程", provider: "deepseek-api" as const, style: "adaptive" as const };
  await cli.invoke(chat, request); await cli.service.idleMaintenance();
  const cliCalls = calls.splice(0); const cliSession = await cli.service.load(chat.id);
  // Restore the same business checkpoint for a differential run, without touching user data.
  if (mode === "lesson") await app.teaching.save(topic, { dayId: "D01", dayCard: "工具回读学习卡", stage: "practice", quizRound: 1, currentExercise: "工具失败后如何恢复？" });
  const desktop = new DesktopService(desktopStore, () => client, app);
  await desktop.send({ ...request, sessionId: base.id, mode }); await desktop.idle(); await desktop.idleMaintenance();
  expect(calls).toEqual(cliCalls);
  expect(calls).toHaveLength(2);
  expect(calls[0]!.options?.tools?.map(tool => tool.name)).toEqual(expect.arrayContaining(["read_conversation_history", "read_execution_history"]));
  expect(calls[0]!.prompt).toContain("fixture-memory");
  expect(calls[0]!.prompt).toContain("可回读的完整原文 8");
  const desktopSession = await desktop.load(base.id);
  expect(desktopSession.context).toEqual(cliSession.context);
  expect(desktopSession.context?.summaryThroughId).toBe(base.messages.at(-7)?.id);
  expect(cliSession.messages).toHaveLength(30);
  expect((await cli.projection(chat)).turns).toHaveLength(6);
  expect(cliSession.messages.at(-1)?.contextUsage).toEqual(desktopSession.messages.at(-1)?.contextUsage);
});

it("keeps confirmed memory and teaching data out of both transports after permission withdrawal", async () => {
  const app = await LearningApplication.open(await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-unified-revoke-")), process.cwd()); apps.push(app);
  await app.profiles.save("rag", { goal: "PRIVATE_PROFILE_FIXTURE", level: "初学", dailyMinutes: 30, totalDays: 7 });
  await app.teaching.save("rag", { dayCard: "PRIVATE_CARD_FIXTURE", stage: "practice", quizRound: 1, currentExercise: "PRIVATE_EXERCISE_FIXTURE" });
  const prompts: string[] = [];
  const client = { async *stream(prompt: string) { prompts.push(prompt); yield { type: "text_delta" as const, text: "只回答当前问题。" }; yield { type: "done" as const }; } };
  const cli = new CliAgentTransport(app.root, app, () => client, () => undefined); const chat = emptyConversation("rag", "lesson");
  const base = await cli.ensure(chat); base.contextAllowed = true; await cli.service.store.save(base);
  await cli.service.updatePermissions(base.id, { materials: false, project: false, external: false }, true);
  const request = { text: "解释检索", provider: "mock" as const, style: "adaptive" as const };
  await cli.invoke(chat, request);
  const desktop = new DesktopService(cli.service.store, () => client, app); await desktop.send({ ...request, sessionId: base.id }); await desktop.idle();
  expect(prompts.join("\n")).not.toContain("PRIVATE_");
  expect((await app.teaching.load("rag"))?.transcript).toEqual([]);
});

it("serializes a topic's teaching checkpoint across different frontend conversations", async () => {
  const app = await LearningApplication.open(await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-teaching-lease-")), process.cwd()); apps.push(app);
  await app.teaching.save("rag", { dayCard: "合成学习卡", stage: "answer_questions", quizRound: 0 });
  let ready!: () => void; const started = new Promise<void>(resolve => { ready = resolve; });
  const first = new DesktopService(new AgentSessionStore(path.join(app.root, "first")), () => ({ async *stream(_prompt, signal) { ready(); await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true })); signal.throwIfAborted(); yield { type: "done" as const }; } }), app);
  const second = new DesktopService(new AgentSessionStore(path.join(app.root, "second")), () => ({ async *stream() { yield { type: "text_delta" as const, text: "新练习：解释检索。" }; yield { type: "done" as const }; } }), app);
  const one = await first.create(); const two = await second.create();
  for (const [service, session] of [[first, one], [second, two]] as const) { session.topicId = "rag"; session.teaching = await app.teaching.load("rag"); await service.store.save(session); }
  const request = { text: "来一道题", provider: "mock" as const, style: "adaptive" as const, topicId: "rag", mode: "lesson" as const, contextAllowed: true };
  try {
    await first.send({ ...request, sessionId: one.id }); await started;
    await expect(second.send({ ...request, sessionId: two.id })).rejects.toThrow("learning_busy");
    expect((await second.load(two.id)).messages).toEqual([]);
    first.stop(); await first.idle();
    await second.send({ ...request, sessionId: two.id }); await second.idle();
    expect((await second.load(two.id)).teaching?.currentExercise).toBe("新练习：解释检索。");
    expect((await app.teaching.load("rag"))?.currentExercise).toBeUndefined();
  } finally { first.stop(); second.stop(); await first.idle(); await second.idle(); await first.pauseMaintenance(); await second.pauseMaintenance(); }
});
