import { z } from "zod/v4";
import type { ExecutionEvidence } from "./execution-evidence.js";
import type { TeamSnapshot } from "./team-contracts.js";
import type { TeamTask } from "./team-task-graph.js";
import type { teamCheckSchema, TeamReport } from "./team-quality.js";

export const teamVerificationSchema = z.object({ status: z.enum(["unresolved", "model-reviewed", "evidence-linked"]), total: z.number().int().nonnegative(), covered: z.number().int().nonnegative(), linked: z.number().int().nonnegative(), issues: z.array(z.string().max(700)).max(64) }).strict();
export type TeamCheck = z.infer<typeof teamCheckSchema>;
export function validateReportEvidence(report: TeamReport, evidence: readonly ExecutionEvidence[]): string | undefined {
  const observed = new Set(evidence.filter(receipt => receipt.ok).map(receipt => receipt.id));
  if (report.claims.some(claim => claim.evidenceIds?.some(id => !observed.has(id)))) return "报告引用了不存在、失败或不属于当前任务的工具回执。只能使用实际返回的 receipt.id；纯推理不要填写 evidenceIds。";
  return undefined;
}
export function validateReviewChecks(checks: readonly TeamCheck[] | undefined, tasks: readonly TeamTask[]): string | undefined {
  const seen = new Set<string>();
  for (const check of checks ?? []) {
    const task = tasks.find(task => task.key === check.task); const key = `${check.task}:${check.criterion}`;
    const source = check.sourceTask ? tasks.find(task => task.key === check.sourceTask) : task;
    const claimed = new Set(source?.report?.claims.flatMap(claim => claim.evidenceIds ?? []));
    if (!task || !source || !task.acceptance[check.criterion] || seen.has(key) || check.claimKeys.some(key => !source.report?.claims.some(claim => claim.key === key)) || check.evidenceIds.some(id => !claimed.has(id) || !source.evidence?.some(receipt => receipt.id === id && receipt.ok)) || check.status === "supported" && (task.status !== "completed" || source.status !== "completed" || !check.claimKeys.length)) return "checks 引用了未知任务、重复/越界的验收项、缺失命题或未关联的实际回执；无法确认时使用 unresolved，不得编造引用。";
    seen.add(key);
  }
  return undefined;
}
export function verifyTeam(state: TeamSnapshot): z.infer<typeof teamVerificationSchema> {
  const tasks = state.tasks ?? []; const review = state.review?.recheck ?? state.review;
  const issues: string[] = []; let total = 0; let covered = 0; let linked = 0;
  const invalid = validateReviewChecks(review?.checks, tasks);
  if (invalid) issues.push(invalid);
  if (!review || review.status !== "completed" || review.verdict !== "ready") issues.push("尚未形成无待处理问题的审查意见。");
  issues.push(...(review?.issues ?? []));
  for (const task of tasks) {
    if (task.status !== "completed") issues.push(`${task.key}：工作尚未完成。`);
    for (const [index, criterion] of task.acceptance.entries()) {
      total++;
      const check = !invalid && review?.checks?.find(check => check.task === task.key && check.criterion === index);
      const source = check && check.sourceTask ? tasks.find(task => task.key === check.sourceTask) : task;
      if (source?.report?.uncertainties.length) issues.push(`${task.key}：采用的依据报告仍有不确定事项。`);
      if (check && check.status === "supported" && task.status === "completed") { covered++; if (check.evidenceIds.length) linked++; }
      else issues.push(`${task.key}：${criterion}，尚未获得有效核查结论。`);
    }
  }
  if (!total) issues.push("没有可追溯的任务验收项。");
  return teamVerificationSchema.parse({ status: issues.length ? "unresolved" : linked === total ? "evidence-linked" : "model-reviewed", total, covered, linked, issues: [...new Set(issues)].slice(0, 64) });
}
