import { qualityRubricHash } from "./explanation-rubric.js";
import { z } from "zod/v4";
import { sourceHash } from "./source-version.js";
import { teamSnapshotSchema } from "./team-contracts.js";
import { teamEvaluationSelectionSchema } from "./team-evaluation-contracts.js";
import { teamDevelopmentCases, teamHoldoutCases } from "./team-evaluation-cases.js";
import { teamQualityCases } from "./team-quality-cases.js";
import { teamExpandedCases } from "./team-expanded-cases.js";
import type { QualityReport } from "./quality-evaluation.js";
export const teamQualityStageSchema = z.enum(["final", "member-1", "member-2", "review", "followup"]);
const rowSchema = z.object({ caseId: z.string().max(64), repeat: z.number().int().min(1).max(2), arm: z.string().max(100), completed: z.boolean(), attempted: z.boolean().optional(), text: z.string().max(100_000), turns: z.array(z.object({ team: teamSnapshotSchema.optional() }).passthrough()).max(5), requests: z.array(z.unknown()).max(12), durationMs: z.number().nonnegative().optional() }).passthrough();
const schema = z.object({ version: z.literal(7), suite: teamEvaluationSelectionSchema.shape.suite, startedAt: z.string().datetime(), datasetHash: z.string().regex(/^[a-f0-9]{64}$/), leadProvider: z.enum(["native-codex", "pi-codex"]).optional(), reasoning: z.string().max(32).optional(), appBundleHash: z.string().regex(/^[a-f0-9]{64}$/).optional(), selection: z.object({ caseIds: teamEvaluationSelectionSchema.shape.caseIds.unwrap(), repetitions: teamEvaluationSelectionSchema.shape.repetitions.unwrap() }).passthrough(), rows: z.array(rowSchema).max(96) }).passthrough();
/** An export prepares review inputs; it never infers semantic correctness from length or JSON. */
export function exportTeamQuality(raw: unknown, selectedStage: z.infer<typeof teamQualityStageSchema>): QualityReport {
  const stage = teamQualityStageSchema.parse(selectedStage), report = schema.parse(raw);
  const corpus = report.suite === "expanded" ? teamExpandedCases : report.suite === "quality" ? teamQualityCases : report.suite === "pilot" ? teamDevelopmentCases : report.suite === "regression" ? teamHoldoutCases.filter(item => ["H02", "H04"].includes(item.id)) : teamHoldoutCases;
  if (report.selection.caseIds.some(id => !corpus.some(item => item.id === id))) throw new Error("team_export_dataset_mismatch");
  const cases = corpus.filter(item => report.selection.caseIds.includes(item.id));
  if (sourceHash(JSON.stringify(cases)) !== report.datasetHash) throw new Error("team_export_dataset_mismatch");
  const native = report.leadProvider === "native-codex";
  const arms = [native ? "single-codex" : "single-pi", native ? "self-review-codex" : "self-review-pi", "same-team", "mixed-team", ...(["pilot", "holdout"].includes(report.suite) ? ["single-deepseek", "single-kimi"] : [])];
  const indexed = new Map<string, z.infer<typeof rowSchema>>();
  for (const row of report.rows) {
    const key = JSON.stringify([row.caseId, row.repeat, row.arm]);
    if (indexed.has(key)) throw new Error("team_export_duplicate");
    if (!cases.some(item => item.id === row.caseId) || !arms.includes(row.arm) || row.repeat > report.selection.repetitions) throw new Error("team_export_row_invalid");
    indexed.set(key, row);
  }
  const results: QualityReport["results"] = [];
  for (const task of cases) for (let repetition = 1; repetition <= report.selection.repetitions; repetition++) for (const arm of arms) {
    const row = indexed.get(JSON.stringify([task.id, repetition, arm])), team = row?.turns.at(-1)?.team;
    let text = row?.text ?? "", attempted = Boolean(row && (row.attempted ?? row.requests.length > 0)), completed = row?.completed ?? false, prompt = task.question, criteria = task.explanationCriteria;
    if (stage !== "final") {
      text = ""; attempted = false; completed = false;
      if (stage.startsWith("member-")) {
        const number = stage === "member-1" ? 1 : 2, member = team?.members[number - 1];
        attempted = Boolean(member?.attempts); completed = member?.status === "completed";
        text = member?.report ? JSON.stringify(member.report) : member?.result ?? "";
        prompt += `\n仅评价此成员的任务：${member?.task ?? "未执行"}`;
        criteria = team?.tasks?.filter(item => item.member === number && item.kind !== "followup").flatMap(item => item.acceptance) ?? [];
        if (!criteria.length) criteria = ["结论与依据符合该成员任务", "明确未核实的事项，不伪造已执行验证"];
      } else {
        const review = team?.review, value = stage === "review" ? review : review?.followUp;
        attempted = Boolean(value && !["pending", "skipped"].includes(value.status)); completed = value?.status === "completed";
        text = stage === "review" && review ? JSON.stringify({ verdict: review.verdict, guidance: review.guidance, issues: review.issues, checks: review.checks }) : review?.followUp?.report ? JSON.stringify(review.followUp.report) : "";
        prompt += `\n阶段输入：${JSON.stringify(team?.members.map(member => ({ task: member.task, report: member.report })) ?? [])}`;
        if (stage === "followup") prompt += `\n待补查问题：${review?.followUp?.question ?? "未执行"}`;
        criteria = ["核查结论与本阶段材料一致", "指出实际错误及未覆盖条件", "不把模型判断说成外部验证"];
      }
    }
    const status = !attempted ? "unavailable" : completed && text.trim() ? "completed" : "failed";
    results.push({ id: task.id, prompt, criteria, provider: arm, repetition, text, attempted, status, review: status === "completed" ? "pending_human_review" : "unavailable", ...(stage === "final" && row?.durationMs !== undefined ? { durationMs: row.durationMs } : {}) });
  }
  return { version: 2, syntheticOnly: true, evaluationDesign: { datasetClassification: "development", rubricHash: qualityRubricHash(stage === "final" ? cases.map(item => ({ id: item.id, criteria: item.explanationCriteria })) : results), rubricTiming: "export_time", caseIds: cases.map(item => item.id) }, startedAt: report.startedAt, datasetHash: report.datasetHash, expectedResults: cases.length * report.selection.repetitions * arms.length, conditions: { details: { leadProvider: report.leadProvider ?? "pi-codex", bindings: report.bindings ?? null, limits: report.limits ?? null, memberReasoning: report.memberReasoning ?? null, provenance: report.provenance ?? null }, dataset: `team-${report.suite}`, requestedReasoning: report.reasoning ?? "unknown", codeHash: report.appBundleHash ?? "unknown", sourceReportHash: sourceHash(JSON.stringify(raw)), stage }, results };
}
