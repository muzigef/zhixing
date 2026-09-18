import { expect, it } from "vitest";
import { evaluateQuality, qualitySeed } from "../src/quality-evaluation.js";

it("runs independent repetitions and preserves unsuccessful answers without awarding quality scores", async () => {
  const calls: string[] = [];
  const report = await evaluateQuality([{ id: "R11", prompt: "检查错误", criteria: ["纠正结论"] }], ["demo"], 2, async (provider, task, repetition) => {
    calls.push(`${provider}/${task.id}/${repetition}`);
    return { status: repetition === 1 ? "completed" : "failed", text: "回答", durationMs: 12 };
  });
  expect(calls).toHaveLength(2);
  expect(report.results.map((item) => item.review)).toEqual(["pending_human_review", "unavailable"]);
  expect(report.results[0]?.criteria).toEqual(["纠正结论"]);
  expect(qualitySeed("R11").at(-1)?.text).toContain("错误");
});
it("rejects excessive live request budgets before running anything", async () => {
  let calls = 0;
  await expect(evaluateQuality([], ["demo"], 100, async () => { calls++; return { status: "completed", text: "" }; })).rejects.toThrow("evaluation_budget_invalid");
  expect(calls).toBe(0);
});

it("records a real clarification as reviewable rather than a provider outage", async () => {
  const report = await evaluateQuality([{ id: "R12", prompt: "继续", criteria: ["必要时澄清"] }], ["demo"], 1, async () => ({ status: "waiting", text: "", items: [{ kind: "question", title: "选择方向" }] }));
  expect(report.results[0]?.review).toBe("pending_human_review");
});
it("persists frozen rubrics before dispatch and resists a runner mutating the reference criteria", async () => {
  const cases = [{ id: "A", prompt: "question", criteria: ["frozen criterion"] }]; let dispatched = 0; let initial: unknown;
  const report = await evaluateQuality(cases, ["demo"], 1, async (_provider, task) => { dispatched++; task.criteria[0] = "lowered criterion"; cases[0]!.criteria[0] = "changed outside"; return { status: "completed", text: "answer", criteria: ["answer-supplied criterion"] }; }, async partial => { if (!dispatched) initial = structuredClone(partial.evaluationDesign); });
  expect(initial).toMatchObject({ datasetClassification: "development", rubricHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(report.results[0]!.criteria).toEqual(["frozen criterion"]);
  await expect(evaluateQuality(cases, ["demo"], 1, async () => { dispatched++; return { status: "completed", text: "unused" }; }, async () => { throw new Error("checkpoint_unavailable"); })).rejects.toThrow("checkpoint_unavailable");
  expect(dispatched).toBe(1);
});
