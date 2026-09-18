import { z } from "zod/v4";
import { sourceHash } from "./source-version.js";
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const known = z.string().trim().min(1).max(1000).refine(value => !/^(?:unknown|unspecified|unverified|未知|未记录)$/i.test(value));
export const evaluationConditionsSchema = z.object({ code: known, model: known, runtime: known, prompt: known, context: known, tools: known, retrieval: known, reasoning: known, budget: known, orchestration: known }).strict();
const factorSchema = evaluationConditionsSchema.keyof();
const specSchema = z.object({ version: z.literal(1), id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), registeredAt: z.string().datetime(), dataset: z.object({ hash: hashSchema, classification: z.enum(["development", "regression", "claimed_unseen_holdout"]), cases: z.array(z.object({ id: z.string().min(1).max(100), exposure: z.enum(["public", "author_seen", "used_for_tuning", "unseen_claimed"]) }).strict()).min(1).max(100) }).strict(), rubricHash: hashSchema, primaryMetric: z.enum(["delivered_field_score", "explanation_correctness", "completion_rate", "latency_ms"]), hypothesis: z.string().trim().min(1).max(2000), comparison: z.object({ kind: z.enum(["single_factor", "ablation", "system"]), factor: factorSchema.optional() }).strict(), arms: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/), conditions: evaluationConditionsSchema }).strict()).min(2).max(4) }).strict();
const runSchema = z.object({ arm: z.string().min(1).max(100), startedAt: z.string().datetime(), datasetHash: hashSchema, rubricHash: hashSchema, conditions: evaluationConditionsSchema, reportHash: hashSchema }).strict();
const exposureSchema = z.object({ caseId: z.string().min(1).max(100), at: z.string().datetime(), kind: z.enum(["prompt_viewed", "answer_viewed", "tuning", "public"]), note: z.string().trim().min(1).max(1000) }).strict();
export function freezeEvaluationDesign(raw: unknown) {
  const spec = specSchema.parse(raw);
  if (new Set(spec.arms.map(arm => arm.id)).size !== spec.arms.length || new Set(spec.dataset.cases.map(item => item.id)).size !== spec.dataset.cases.length) throw new Error("evaluation_design_duplicate");
  if (spec.dataset.classification === "claimed_unseen_holdout" && spec.dataset.cases.some(item => item.exposure !== "unseen_claimed")) throw new Error("evaluation_holdout_exposed");
  if (spec.comparison.kind === "system") { if (spec.comparison.factor) throw new Error("evaluation_design_confound"); }
  else {
    if (!spec.comparison.factor) throw new Error("evaluation_design_confound");
    for (const arm of spec.arms.slice(1)) {
      const changes = factorSchema.options.filter(key => arm.conditions[key] !== spec.arms[0]!.conditions[key]);
      if (changes.length !== 1 || changes[0] !== spec.comparison.factor) throw new Error("evaluation_design_confound");
    }
  }
  return { version: 1 as const, hash: sourceHash(JSON.stringify(spec)), spec };
}
export function inspectEvaluationDesign(rawFrozen: unknown, rawRuns: unknown, rawExposures: unknown) {
  const frozen = z.object({ version: z.literal(1), hash: hashSchema, spec: specSchema }).strict().parse(rawFrozen), expected = freezeEvaluationDesign(frozen.spec);
  if (expected.hash !== frozen.hash) throw new Error("evaluation_design_changed");
  const runs = z.array(runSchema).max(4).parse(rawRuns), exposures = z.array(exposureSchema).max(2000).parse(rawExposures);
  if (new Set(runs.map(run => run.arm)).size !== runs.length) throw new Error("evaluation_run_duplicate");
  if (exposures.some(event => !frozen.spec.dataset.cases.some(item => item.id === event.caseId))) throw new Error("evaluation_exposure_unknown_case");
  const problems: string[] = [];
  for (const run of runs) {
    const declared = frozen.spec.arms.find(arm => arm.id === run.arm);
    if (!declared) { problems.push(`${run.arm}:undeclared_arm`); continue; }
    if (Date.parse(run.startedAt) < Date.parse(frozen.spec.registeredAt)) problems.push(`${run.arm}:registered_after_run`);
    if (run.datasetHash !== frozen.spec.dataset.hash) problems.push(`${run.arm}:dataset_changed`);
    if (run.rubricHash !== frozen.spec.rubricHash) problems.push(`${run.arm}:rubric_changed`);
    for (const key of factorSchema.options) if (run.conditions[key] !== declared.conditions[key]) problems.push(`${run.arm}:changed_${key}`);
  }
  const missingArms = frozen.spec.arms.filter(arm => !runs.some(run => run.arm === arm.id)).map(arm => arm.id);
  const lastRun = runs.length ? Math.max(...runs.map(run => Date.parse(run.startedAt))) : Infinity;
  const exposedCases = [...new Set([...frozen.spec.dataset.cases.filter(item => item.exposure !== "unseen_claimed").map(item => item.id), ...exposures.filter(event => Date.parse(event.at) <= lastRun).map(event => event.caseId)])].sort();
  return { version: 1, designHash: frozen.hash, comparison: frozen.spec.comparison, primaryMetric: frozen.spec.primaryMetric, conditionsMatched: !problems.length && !missingArms.length, missingArms, problems, exposedCases, exposures, holdoutEligible: frozen.spec.dataset.classification === "claimed_unseen_holdout" && !exposedCases.length && !problems.length && !missingArms.length, reportHashes: runs.map(run => ({ arm: run.arm, hash: run.reportHash })), interpretation: "预注册时间、未见题与运行条件来自显式声明和文件哈希，不是不可伪造的第三方认证。事后注册、评分标准改变和未声明条件变化单列；多因素系统比较不能归因于单一模块。运行后的曝光仍保留在台账，后续使用不再声称未见。" };
}
