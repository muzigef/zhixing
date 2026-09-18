import { expect, it } from "vitest";
import { freezeEvaluationDesign, inspectEvaluationDesign } from "../src/evaluation-design.js";
const hash = "a".repeat(64), time = "2026-09-18T00:00:00.000Z";
const conditions = { code: hash, model: "model-v1", runtime: "cli-v1", prompt: hash, context: hash, tools: "none", retrieval: "none", reasoning: "quick", budget: "requests=5;output=16000", orchestration: "single" };
const spec = () => ({ version: 1, id: "dev-comparison", registeredAt: time, dataset: { hash, classification: "development", cases: [{ id: "X01", exposure: "public" }] }, rubricHash: hash, primaryMetric: "delivered_field_score", hypothesis: "团队编排是否改变交付质量", comparison: { kind: "single_factor", factor: "orchestration" }, arms: [{ id: "single", conditions }, { id: "team", conditions: { ...conditions, orchestration: "team" } }] });
it("freezes all conditions and rejects multiple changes masquerading as a single-factor ablation", () => {
  const input = spec(), frozen = freezeEvaluationDesign(input);
  expect(frozen.hash).toMatch(/^[a-f0-9]{64}$/);
  input.arms[1]!.conditions.budget = "larger";
  expect(() => freezeEvaluationDesign(input)).toThrow("evaluation_design_confound");
  expect(() => freezeEvaluationDesign({ ...spec(), comparison: { kind: "ablation", factor: "model" } })).toThrow("evaluation_design_confound");
  expect(frozen.spec.arms[1]!.conditions.budget).toBe(conditions.budget);
});
it("rejects exposed questions as unseen, and records subsequent exposure without rewriting the frozen registration", () => {
  expect(() => freezeEvaluationDesign({ ...spec(), dataset: { ...spec().dataset, classification: "claimed_unseen_holdout" } })).toThrow("evaluation_holdout_exposed");
  const frozen = freezeEvaluationDesign({ ...spec(), dataset: { hash, classification: "claimed_unseen_holdout", cases: [{ id: "new", exposure: "unseen_claimed" }] } });
  const runs = frozen.spec.arms.map(arm => ({ arm: arm.id, startedAt: "2026-09-18T00:01:00.000Z", datasetHash: hash, rubricHash: hash, conditions: arm.conditions, reportHash: hash }));
  const result = inspectEvaluationDesign(frozen, runs, [{ caseId: "new", at: "2026-09-18T00:00:30.000Z", kind: "tuning", note: "已根据该题修改提示词" }]);
  expect(result).toMatchObject({ conditionsMatched: true, holdoutEligible: false, exposedCases: ["new"], interpretation: expect.stringContaining("声明") });
});
it("detects post-hoc registration, changed rubric, missing arms and tampered frozen configuration", () => {
  const frozen = freezeEvaluationDesign(spec());
  const runs = frozen.spec.arms.map(arm => ({ arm: arm.id, startedAt: "2026-09-18T00:01:00.000Z", datasetHash: hash, rubricHash: hash, conditions: arm.conditions, reportHash: hash }));
  expect(inspectEvaluationDesign(frozen, runs, [])).toMatchObject({ conditionsMatched: true, missingArms: [], holdoutEligible: false });
  expect(inspectEvaluationDesign(frozen, runs.slice(0, 1), []).missingArms).toEqual(["team"]);
  expect(inspectEvaluationDesign(frozen, [{ ...runs[0]!, startedAt: "2026-09-17T00:00:00.000Z", rubricHash: "b".repeat(64) }, runs[1]!], []).problems).toEqual(expect.arrayContaining(["single:registered_after_run", "single:rubric_changed"]));
  expect(() => inspectEvaluationDesign({ ...frozen, hash: "b".repeat(64) }, runs, [])).toThrow("evaluation_design_changed");
  expect(() => inspectEvaluationDesign(frozen, runs, [{ caseId: "outside", at: time, kind: "public", note: "not in set" }])).toThrow("evaluation_exposure_unknown_case");
});
it("marks exposure between the two arm runs as contaminated for the overall comparison", () => {
  const frozen = freezeEvaluationDesign({ ...spec(), dataset: { hash, classification: "claimed_unseen_holdout", cases: [{ id: "new", exposure: "unseen_claimed" }] } });
  const runs = frozen.spec.arms.map((arm, index) => ({ arm: arm.id, startedAt: index ? "2026-09-18T00:03:00.000Z" : "2026-09-18T00:01:00.000Z", datasetHash: hash, rubricHash: hash, conditions: arm.conditions, reportHash: hash }));
  expect(inspectEvaluationDesign(frozen, runs, [{ caseId: "new", at: "2026-09-18T00:02:00.000Z", kind: "answer_viewed", note: "在第二组运行前看过答案" }])).toMatchObject({ holdoutEligible: false, exposedCases: ["new"] });
});
it("freezes and checks through the actual CLI, preserving a failed-condition artifact and refusing overwrite", async () => {
  const fs = await import("node:fs/promises"), os = await import("node:os"), path = await import("node:path"), { execFile } = await import("node:child_process"), { promisify } = await import("node:util");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "design-cli-"));
  const run = (...args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/evaluation-design.ts", ...args], { timeout: 10_000 });
  try {
    await fs.writeFile(path.join(root, "spec.json"), JSON.stringify(spec()));
    const output = path.join(root, "frozen.json"); await run("freeze", `--spec=${path.join(root, "spec.json")}`, `--output=${output}`);
    const frozen = JSON.parse(await fs.readFile(output, "utf8"));
    const runs = frozen.spec.arms.map((arm: { id: string; conditions: typeof conditions }) => ({ arm: arm.id, startedAt: "2026-09-18T00:01:00.000Z", datasetHash: hash, rubricHash: hash, conditions: arm.conditions, reportHash: hash }));
    await fs.writeFile(path.join(root, "runs.json"), JSON.stringify(runs));
    await run("check", `--design=${output}`, `--runs=${path.join(root, "runs.json")}`, `--output=${path.join(root, "checked.json")}`);
    runs[1].conditions.reasoning = "deep"; await fs.writeFile(path.join(root, "runs.json"), JSON.stringify(runs));
    await expect(run("check", `--design=${output}`, `--runs=${path.join(root, "runs.json")}`, `--output=${path.join(root, "failed.json")}`)).rejects.toMatchObject({ code: 1 });
    expect(JSON.parse(await fs.readFile(path.join(root, "failed.json"), "utf8"))).toMatchObject({ conditionsMatched: false, problems: ["team:changed_reasoning"] });
    await expect(run("freeze", `--spec=${path.join(root, "spec.json")}`, `--output=${output}`)).rejects.toMatchObject({ code: 1 });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
