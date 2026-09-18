import { validateRegistry, studyTicket } from "./teaching-study-registry.js";
import { mergeOutcomeExports, validatedOutcomeTrials } from "./outcome-report.js";
export { createTeachingStudy, studyTicket, validateStudyTicket } from "./teaching-study-registry.js";
/** Intent-to-treat accounting. Self-report identity and protocol hashes are not attestation. */
export function inspectTeachingStudy(raw: unknown, exports: unknown[]) {
  const registry = validateRegistry(raw), plan = registry.plan;
  const trials = exports.length ? validatedOutcomeTrials(exports) : [];
  const expectedIds = new Set(registry.assignments.map(a => a.trialId));
  if (trials.some(trial => !expectedIds.has(trial.id))) throw new Error("study_unassigned_trial");
  const records = registry.assignments.map(assignment => {
    const trial = trials.find(t => t.id === assignment.trialId), ticket = studyTicket(registry, assignment.participantCode), deviations: string[] = [];
    if (trial && (trial.mode !== assignment.mode || trial.topicId !== plan.topicId || trial.protocol !== plan.protocol || trial.study?.ticketHash !== ticket.ticketHash || trial.study.registryHash !== registry.registryHash || trial.study.planHash !== registry.planHash || trial.study.participantCode !== assignment.participantCode || trial.study.assignedAt !== assignment.assignedAt || Date.parse(trial.createdAt) < Date.parse(assignment.assignedAt))) throw new Error("study_assignment_mismatch");
    if (!trial) deviations.push("not_started");
    else {
      if (trial.stage === "abandoned") deviations.push("abandoned");
      if (trial.repeated) deviations.push("repeated");
      if (trial.provenance?.codeHash !== plan.codeHash) deviations.push("build_mismatch");
      if (!trial.lesson?.completedTurns) deviations.push("no_completed_lesson");
      if ((trial.lesson?.durationMs ?? 0) < plan.minimumLearningMs) deviations.push("learning_duration_below_plan");
      if (!trial.lesson?.conditions.length || trial.lesson.conditions.some(c => c.provider !== plan.provider || c.model !== plan.model || c.reasoning !== plan.reasoning || c.style !== plan.style || c.codeHash !== plan.codeHash)) deviations.push("changed_conditions");
      if (Object.values(trial.results).some(r => r.assistance !== "independent")) deviations.push("assisted");
    }
    const delayed = trial?.results.delayed, post = trial?.results.post;
    const timely = Boolean(delayed && post && Date.parse(delayed.submittedAt) - Date.parse(post.submittedAt) >= plan.minimumRetentionHours * 3600000);
    if (delayed && !timely) deviations.push("retention_too_early");
    const score = timely ? delayed!.correctCount : null;
    if (score === null) deviations.push("primary_missing");
    return { participantCode: assignment.participantCode, trialId: assignment.trialId, mode: assignment.mode, started: Boolean(trial), score, recordedDelayedScore: delayed?.correctCount ?? null, deviations };
  });
  const arms = (["zhixing", "direct"] as const).map(mode => {
    const assigned = records.filter(r => r.mode === mode), observed = assigned.filter(r => r.score !== null), sum = observed.reduce((n, r) => n + r.score!, 0), missing = assigned.length - observed.length;
    const perProtocol = observed.filter(r => !r.deviations.length);
    return { mode, assigned: assigned.length, observed: observed.length, missing, missingRate: assigned.length ? missing / assigned.length : null, observedMean: observed.length ? sum / observed.length : null, primaryEstimate: assigned.length && (!missing || plan.missingRule === "zero_imputation") ? sum / assigned.length : null, primaryBounds: assigned.length ? [sum / assigned.length, (sum + 3 * missing) / assigned.length] : null, perProtocol: { count: perProtocol.length, mean: perProtocol.length ? perProtocol.reduce((n, r) => n + r.score!, 0) / perProtocol.length : null } };
  });
  const [a, b] = arms;
  return { version: 1, registryHash: registry.registryHash, plan, randomized: records.length, started: records.filter(r => r.started).length, observed: records.filter(r => r.score !== null).length, missing: records.filter(r => r.score === null).length, duplicateExports: exports.length ? mergeOutcomeExports(exports).duplicates : 0, arms, records,
    differenceBounds: a!.primaryBounds && b!.primaryBounds ? [a!.primaryBounds[0]! - b!.primaryBounds[1]!, a!.primaryBounds[1]! - b!.primaryBounds[0]!] : null,
    differentialAttrition: a!.missingRate !== null && b!.missingRate !== null ? a!.missingRate - b!.missingRate : null,
    allocationConcealmentVerified: false, participantIdentitiesVerified: false, realStudyVerified: false, causalEffectEstablished: false,
    interpretation: "全体预分配代号保留在意向性分母；主要指标是 72 小时后 0–3 分延迟答对数。缺失上下界不是置信区间；仅按冻结方案可另给缺失填零估计。帮助/条件改变不删出意向性统计，合规完成者仅为敏感性描述。简单随机不保证组间人数相等；哈希不认证招募、身份、分配隐藏或研究效力。" };
}
