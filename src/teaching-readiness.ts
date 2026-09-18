import { z } from "zod/v4";
import { mergeOutcomeExports, validatedOutcomeTrials } from "./outcome-report.js";
export const teachingReadinessCriteriaSchema = z.object({ version: z.literal(1), topicId: z.enum(["agent-development", "rag"]), protocol: z.literal("full_product"), codeHash: z.string().regex(/^[a-f0-9]{64}$/), provider: z.string().min(1).max(128), model: z.string().min(1).max(128), reasoning: z.enum(["quick", "balanced", "deep"]), style: z.enum(["concise", "adaptive", "detailed"]), minimumRecords: z.number().int().min(1).max(1000), minimumIndependentReviewers: z.literal(2), minimumRetentionHours: z.literal(72), minimumLearningMs: z.number().int().min(0).max(86_400_000), dataOrigin: z.enum(["synthetic", "real_declared", "unknown"]) }).strict();
/** Completeness, not positive scores: poor or conflicting assessed outcomes remain data. */
export function inspectTeachingReadiness(exports: unknown[], rawCriteria: unknown) {
  const criteria = teachingReadinessCriteriaSchema.parse(rawCriteria), merged = mergeOutcomeExports(exports), trials = validatedOutcomeTrials(exports);
  const records = trials.map(trial => {
    const problems: string[] = [];
    if (trial.topicId !== criteria.topicId || trial.protocol !== criteria.protocol) problems.push("protocol_mismatch");
    if (trial.stage !== "complete") problems.push("not_complete");
    if (trial.repeated) problems.push("repeated_record");
    if (trial.provenance?.codeHash !== criteria.codeHash) problems.push("build_mismatch");
    if (!trial.lesson || !trial.lesson.completedTurns) problems.push("no_completed_lesson");
    if ((trial.lesson?.durationMs ?? 0) < criteria.minimumLearningMs) problems.push("learning_duration_below_plan");
    if (!trial.lesson?.conditions.length || trial.lesson.conditions.some(condition => condition.codeHash !== criteria.codeHash || condition.provider !== criteria.provider || condition.model !== criteria.model || condition.reasoning !== criteria.reasoning || condition.style !== criteria.style)) problems.push("changed_conditions");
    const phases = (["pre", "post", "delayed"] as const).map(phase => {
      const result = trial.results[phase];
      if (!result) { problems.push(`${phase}:missing`); return { phase, reviewers: 0, transferVerdicts: [] as string[] }; }
      if (result.assistance !== "independent") problems.push(`${phase}:assisted`);
      if (!result.transferExample || !result.transferPrompt) problems.push(`${phase}:transfer_missing`);
      const latest = new Map((result.reviews ?? []).map(review => [review.reviewer.normalize("NFKC").trim().toLowerCase(), review]));
      const active = [...latest.values()].filter(review => review.verdict !== "withdrawn" && review.declaration?.kind === "human" && review.declaration.independent);
      if (active.length < criteria.minimumIndependentReviewers) problems.push(`${phase}:independent_double_review_missing`);
      const transfer = active.flatMap(review => review.transferVerdict ? [review.transferVerdict] : []);
      if (transfer.length < criteria.minimumIndependentReviewers) problems.push(`${phase}:transfer_double_review_missing`);
      return { phase, reviewers: active.length, transferVerdicts: transfer, disagreement: new Set(active.map(review => review.verdict)).size > 1 || new Set(transfer).size > 1 };
    });
    if (trial.results.pre && trial.results.post && Date.parse(trial.results.post.submittedAt) < Date.parse(trial.results.pre.submittedAt)) problems.push("phase_time_invalid");
    const retentionHours = trial.results.post && trial.results.delayed ? (Date.parse(trial.results.delayed.submittedAt) - Date.parse(trial.results.post.submittedAt)) / 3600000 : null;
    if (retentionHours !== null && retentionHours < criteria.minimumRetentionHours) problems.push("retention_too_early");
    return { id: trial.id, mode: trial.mode, ready: !problems.length, problems, phases, retentionHours, delayedCorrect: trial.results.delayed?.correctCount ?? null, transferVerdicts: phases.find(phase => phase.phase === "delayed")!.transferVerdicts };
  });
  const completeRecords = records.filter(record => record.ready).length;
  return { version: 1, criteria, dataOrigin: criteria.dataOrigin, recorded: records.length, duplicateExports: merged.duplicates, completeRecords, dataCompletenessReady: completeRecords >= criteria.minimumRecords, participantIdentitiesVerified: false, realStudyVerified: false, causalEffectEstablished: false, records,
    interpretation: "此门禁只核对记录完整性、声明的条件、实际延迟及来源绑定的双人评分，差或不一致的评分仍保留，不按好结果筛选。参与身份与评阅者独立性仍为声明；合成数据不能证明真实学习效果。随机分配、预注册样本依据和缺失处理需由研究协议另行验收；这些偏离不应从意向性分析中静默删除。" };
}
