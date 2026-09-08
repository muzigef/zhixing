import { summarizeOutcomes } from "../src/learning-outcomes.js";
import { mergeOutcomeExports } from "../src/outcome-report.js";
import { afterEach, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LearningApplication } from "../src/learning-application.js";
import { AgentService } from "../src/agent-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { sourceProvenance } from "../src/build-provenance.js";
import type { ModelRequestOptions } from "../src/model.js";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function fixture() { const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-product-validation-")); const app = await LearningApplication.open(root, process.cwd()); cleanup.push(async () => { app.close(); await fs.rm(root, { recursive: true, force: true }); }); return { root, app }; }
it("issues different problems for the same concepts and retains the original issued answers", async () => {
  const { app } = await fixture(); await app.handle("开始第 1 天", "agent-development");
  const first = await app.startAssessment("agent-development", "D01"); const second = await app.startAssessment("agent-development", "D01");
  expect(first.questions.map(item => item.title)).not.toEqual(second.questions.map(item => item.title));
  expect(second.bankVersion).toBeTruthy(); expect(second.formId).not.toBe(first.formId);
  const result = await app.submitAssessment("agent-development", "D01", first.id, [0, 2], "保留原题作答", "independent");
  expect(result.correctCount).toBe(2); expect(result.bankVersion).toBe(first.bankVersion);
});
it.each(["zhixing", "direct"] as const)("runs the full-product %s protocol without exposing learner checks to the model", async mode => {
  const { root, app } = await fixture(); const seen: { prompt: string; options?: ModelRequestOptions }[] = [];
  const client = { async *stream(prompt: string, _signal: AbortSignal, options?: ModelRequestOptions) { seen.push({ prompt, options }); yield { type: "text_delta" as const, text: "合成解释" }; yield { type: "done" as const }; }, async *continue() { yield { type: "done" as const }; } };
  const service = new AgentService(new AgentSessionStore(path.join(root, "sessions")), () => client, app); cleanup.push(async () => service.pauseMaintenance());
  const trial = app.outcomes.start("rag", mode, "full_product");
  app.outcomes.submit("rag", trial.id, "pre", { answers: [0, 1, 2], explanation: "不得发送的合成学前解释", assistance: "independent" });
  const session = await service.openOutcomeLesson("rag", trial.id);
  await service.send({ sessionId: session.id, provider: "mock", style: "adaptive", text: "解释检索", access: { materials: true, project: false, external: false } }); await service.idle();
  expect(seen[0]!.prompt).not.toContain("不得发送的合成学前解释");
  expect(seen[0]!.options?.tools?.some(tool => tool.name === "search_materials") ?? false).toBe(mode === "zhixing");
  const finished = await service.finishOutcomeLesson("rag", trial.id);
  expect(finished.protocol).toBe("full_product"); expect(finished.lesson?.conditions[0]?.codeHash).toMatch(/^[a-f0-9]{64}$/);
  expect(finished.provenance?.files.some(file => file.path === "desktop/renderer/index.tsx")).toBe(true);
});
it("fingerprints renderer, worker, dependencies, skills and evaluation data", async () => {
  const { root } = await fixture(); const repo = path.join(root, "synthetic-source");
  const files = ["src/main.ts", "desktop/renderer/index.tsx", "desktop/electron/pi-model-worker.ts", "desktop/package-lock.json", "package-lock.json", "skills/shared/demo/SKILL.md", "docs/agent-quality-cases.json"];
  for (const name of files) { await fs.mkdir(path.dirname(path.join(repo, name)), { recursive: true }); await fs.writeFile(path.join(repo, name), "synthetic source"); }
  let previous = await sourceProvenance(repo);
  for (const name of files) { await fs.appendFile(path.join(repo, name), " changed"); const next = await sourceProvenance(repo); expect(next.codeHash, name).not.toBe(previous.codeHash); previous = next; }
  expect(previous.files.map(file => file.path)).toEqual([...files].sort());
});

it("separates product protocols/builds and rejects conflicting provenance in exports", async () => {
  const { root, app } = await fixture(); const provenance = await sourceProvenance(path.join(root, "empty-source"));
  const trial = app.outcomes.start("rag", "zhixing", "full_product");
  const answer = { answers: [-1, -1, -1], explanation: "合成统计", assistance: "independent" };
  app.outcomes.submit("rag", trial.id, "pre", answer); app.outcomes.bindProvenance("rag", trial.id, provenance); app.outcomes.attachSession("rag", trial.id, trial.id);
  app.outcomes.finishLesson("rag", trial.id, { sessionId: trial.id, completedTurns: 1, failedTurns: 0, durationMs: 1, conditions: [{ provider: "pi-codex", model: "fixture", reasoning: "quick", style: "adaptive", codeHash: provenance.codeHash }] });
  const post = app.outcomes.submit("rag", trial.id, "post", answer);
  const another = { ...post, provenance: { ...provenance, codeHash: "a".repeat(64) }, lesson: { ...post.lesson!, conditions: post.lesson!.conditions.map(c => ({ ...c, codeHash: "a".repeat(64) })) } };
  expect(summarizeOutcomes([post, { ...post, protocol: "prompt_only" }, another]).groups).toHaveLength(3);
  expect(summarizeOutcomes([{ ...post, provenance: undefined }]).exclusions.unknown_or_changed_build).toBe(1);
  const file = { version: 1, exportedAt: new Date().toISOString(), topicId: "rag", assignment: "learner_selected", trials: [post] };
  expect(() => mergeOutcomeExports([file, { ...file, trials: [another] }])).toThrow("outcome_export_conflict");
});

it("aligns both authored forms with all 24 concepts and preserves assistance distinctions", async () => {
  const { app } = await fixture();
  const keys: Record<string, number[][]> = { "agent-development": [[0, 2], [1, 2], [1, 2]], rag: [[0, 1], [2, 1], [1, 2]], "tool-calling": [[0, 1], [1, 2], [1, 2]], "interview-project": [[2, 0], [1, 2], [1, 0]] };
  for (const [topic, days] of Object.entries(keys)) for (const [index, answers] of days.entries()) {
    const day = `D0${index + 1}`; const first = app.assessments.issue(topic, day); const second = app.assessments.issue(topic, day);
    expect(first.questions.map(q => q.title)).not.toEqual(second.questions.map(q => q.title));
    const independent = app.assessments.submit(topic, day, first.id, answers, "合成独立作答", new Date(), "independent");
    const helped = app.assessments.submit(topic, day, second.id, answers, "合成参考答案", new Date(), "solution");
    expect(independent.correctCount).toBe(2); expect(helped.correctCount).toBe(2);
    expect(helped.assistance).toBe("solution"); expect(helped.concepts?.map(c => c.conceptId)).toEqual(independent.concepts?.map(c => c.conceptId));
    expect(new Set(helped.concepts?.map(c => c.conceptId)).size).toBe(2);
  }
});
