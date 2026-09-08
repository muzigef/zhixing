import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { LearningApplication } from "../src/learning-application.js";
import type { ModelClient, ModelMessage } from "../src/model.js";
import { DesktopStore } from "../desktop/core/store.js";
import { DesktopService } from "../desktop/core/service.js";
import { buildMessages } from "../src/learning-agent-profile.js";
import { desktopCommandSchema } from "../desktop/core/contracts.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-outcomes-"));
  const app = await LearningApplication.open(path.join(root, "workspace"), process.cwd());
  const prompts: string[] = [];
  const client: ModelClient = { async *stream(prompt) { prompts.push(prompt); yield { type: "usage", usage: { model: "test-model", inputTokens: 10, outputTokens: 10 } }; yield { type: "text_delta", text: "先核对执行结果，再根据权限决定能否操作。" }; yield { type: "done" }; } };
  const service = new DesktopService(new DesktopStore(path.join(root, "desktop")), () => client, app);
  cleanups.push(async () => { service.stop(); await service.idle(); await service.pauseMaintenance(); app.close(); await fs.rm(root, { recursive: true, force: true }); });
  return { app, service, prompts };
}
const submission = { answers: [0, 1, 2], explanation: "我的理由只保存在本地检查里。", assistance: "independent" as const };

it("binds an isolated lesson to an actual session and measures only after a completed model response", async () => {
  const { app, service, prompts } = await fixture();
  const initialDays = (await app.overview("agent-development")).days;
  const trial = app.outcomes.start("agent-development", "direct");
  app.outcomes.submit("agent-development", trial.id, "pre", submission);
  const lesson = await service.openOutcomeLesson("agent-development", trial.id);
  expect((await service.openOutcomeLesson("agent-development", trial.id)).id).toBe(lesson.id);
  await expect(service.finishOutcomeLesson("agent-development", trial.id)).rejects.toThrow("outcome_lesson_incomplete");
  await service.send({ sessionId: lesson.id, text: "请开始讲解。", provider: "demo", style: "concise", contextAllowed: true, execution: "session" });
  await service.idle();
  expect(prompts[0]).not.toContain(submission.explanation);
  expect(prompts[0]).not.toContain(trial.questions[0]!.title);
  expect(prompts[0]).not.toContain("本轮刚读取的受控快照");
  const stored = await service.load(lesson.id);
  expect(stored.contextAllowed).toBe(false); expect(stored.executionAllowed).toBe(false);
  const post = await service.finishOutcomeLesson("agent-development", trial.id);
  expect(post.lesson).toMatchObject({ completedTurns: 1, conditions: [{ provider: "demo", model: "test-model", reasoning: "balanced", style: "concise" }] });
  await expect(service.send({ sessionId: lesson.id, text: "代我完成检查", provider: "demo", style: "concise" })).rejects.toThrow("outcome_stage_invalid");
  expect((await app.overview("agent-development")).days).toEqual(initialDays);
});

it("changes only the teaching instruction between modes and never exports answers into prompts", async () => {
  const { service } = await fixture(); const session = await service.create();
  const request = { sessionId: session.id, text: "相同问题", provider: "demo" as const, style: "adaptive" as const };
  const make = (mode: "zhixing" | "direct"): ModelMessage[] => buildMessages({ ...session, topicId: "rag", study: { id: session.id, mode }, context: { goal: "禁止泄露的历史", notes: "无关约束" } }, request);
  expect(make("zhixing")[0]!.content).toContain("先用简短讲解");
  expect(make("direct")[0]!.content).not.toContain("先用简短讲解");
  expect(make("direct").slice(1)).toEqual(make("zhixing").slice(1));
  expect(JSON.stringify(make("zhixing"))).not.toContain("禁止泄露的历史");
  expect(desktopCommandSchema.safeParse({ type: "outcome-submit", topicId: "rag", id: session.id, phase: "pre", submission: { ...submission, source: "assistant" } }).success).toBe(false);
});
