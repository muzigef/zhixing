import { afterEach, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LearningApplication } from "../src/learning-application.js";
import { TeachingPolicy } from "../src/teaching-policy.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-teaching-policy-")); const app = await LearningApplication.open(root, process.cwd());
  cleanup.push(async () => { app.close(); await fs.rm(root, { recursive: true, force: true }); });
  await app.handle("开始第 1 天", "agent-development");
  return app;
}
it("selects concept evidence in Chinese and English rather than generic first-person keywords", async () => {
  const app = await fixture(); const attempt = await app.startAssessment("agent-development", "D01");
  await app.submitAssessment("agent-development", "D01", attempt.id, [1, 2], "合成复盘", "independent");
  const policy = new TeachingPolicy(app.observations);
  const evidence = policy.decide("agent-development", "Explain execution evidence");
  expect(evidence.action).toBe("contrast_example"); expect(evidence.concepts[0]).toMatchObject({ id: "execution-evidence", state: "practice_needed", sources: [{ id: attempt.id, revision: 1, questionIndex: 0 }] });
  expect(policy.decide("agent-development", "Explain runtime permissions").action).toBe("transfer_practice");
  expect(policy.decide("agent-development", "我想知道天气").concepts).toEqual([]);
  expect(policy.decide("rag", "执行证据").concepts).toEqual([]);
  expect((await app.context("agent-development", "Explain execution evidence", true, new AbortController().signal)).text).toContain("contrast_example");
});
it("distinguishes assisted answers, respects direct answers, and applies corrections/retractions immediately", async () => {
  const app = await fixture(); const attempt = await app.startAssessment("agent-development", "D01");
  await app.submitAssessment("agent-development", "D01", attempt.id, [0, 2], "用了提示", "hint");
  const policy = new TeachingPolicy(app.observations);
  expect(policy.decide("agent-development", "执行证据").action).toBe("guided_practice");
  expect(policy.decide("agent-development", "执行证据，直接给答案").action).toBe("direct_answer");
  expect(policy.decide("agent-development", "执行证据，不要直接给答案，只给提示").action).toBe("hint");
  app.observations.update("agent-development", attempt.id, 1, "更正：不确定是否独立完成", false);
  expect(policy.decide("agent-development", "执行证据").concepts[0]?.sources[0]).toMatchObject({ revision: 2, correction: expect.stringContaining("更正") });
  app.observations.update("agent-development", attempt.id, 2, "撤回", true);
  expect(policy.decide("agent-development", "执行证据").concepts[0]).toMatchObject({ state: "unobserved", sources: [] });
  expect(policy.decide("agent-development", "执行证据").action).toBe("explain");
});
it("does not reinterpret a legacy aggregate score as concept-level evidence", async () => {
  const app = await fixture(); const attempt = await app.startAssessment("agent-development", "D01");
  await app.submitAssessment("agent-development", "D01", attempt.id, [0, 2], "旧格式", "independent");
  const row = app.observations.list("agent-development")[0]!;
  const legacy = { ...row, concepts: undefined };
  app.database.db.prepare("UPDATE learning_observations SET value=? WHERE id=?").run(JSON.stringify(legacy), row.id);
  const selected = new TeachingPolicy(app.observations).decide("agent-development", "执行证据");
  expect(selected.concepts[0]?.state).toBe("unobserved");
});
