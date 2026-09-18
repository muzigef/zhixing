import { outcomeAssignment, outcomeExportSchema, type OutcomeView } from "./outcome-contracts.js";
import { outcomeBank } from "./outcome-bank.js";
import { summarizeOutcomes } from "./learning-outcomes.js";
import { validateExplanationReviews } from "./outcome-calibration.js";

/** Merge only explicitly exported records; identifiers survive backups so copies aren't new samples. */
export function mergeOutcomeExports(raw: unknown[]) {
  if (!raw.length || raw.length > 100) throw new Error("outcome_export_limit");
  const records = new Map<string, { trial: OutcomeView; exportedAt: string }>(); let duplicates = 0;
  for (const value of raw) {
    const file = outcomeExportSchema.parse(value);
    if (file.assignment !== outcomeAssignment(file.trials)) throw new Error("outcome_assignment_label_invalid");
    for (const trial of file.trials) {
      if (trial.topicId !== file.topicId) throw new Error("cross_topic_denied");
      validateExplanationReviews(trial);
      for (const result of Object.values(trial.results)) if (result) {
        const questions = outcomeBank[trial.topicId]!.forms[result.formId]!;
        if (questions.filter((q, i) => q.correct === result.answers[i]).length !== result.correctCount) throw new Error("outcome_export_invalid_score");
      }
      const previous = records.get(trial.id);
      if (previous) {
        duplicates++;
        for (const key of ["topicId", "mode", "bankVersion", "createdAt", "repeated"] as const) if (previous.trial[key] !== trial[key]) throw new Error("outcome_export_conflict");
        if (JSON.stringify(previous.trial.study) !== JSON.stringify(trial.study)) throw new Error("outcome_export_conflict");
        if ((previous.trial.protocol ?? "prompt_only") !== (trial.protocol ?? "prompt_only") || previous.trial.provenance && trial.provenance && JSON.stringify(previous.trial.provenance) !== JSON.stringify(trial.provenance) || previous.trial.lesson && trial.lesson && JSON.stringify(previous.trial.lesson) !== JSON.stringify(trial.lesson)) throw new Error("outcome_export_conflict");
        for (const phase of ["pre", "post", "delayed"] as const) {
          const before = previous.trial.results[phase]; const after = trial.results[phase];
          if (before && after) {
            const immutable = (value: typeof before) => ({ ...value, reviews: undefined, explanationReview: undefined });
            if (JSON.stringify(immutable(before)) !== JSON.stringify(immutable(after))) throw new Error("outcome_export_conflict");
            const [earlier, later] = previous.exportedAt <= file.exportedAt ? [before, after] : [after, before];
            if ((earlier.reviews ?? []).some((review, index) => JSON.stringify(review) !== JSON.stringify(later.reviews?.[index])) || previous.exportedAt === file.exportedAt && JSON.stringify(before) !== JSON.stringify(after)) throw new Error("outcome_export_conflict");
          }
        }
        if (Date.parse(previous.exportedAt) >= Date.parse(file.exportedAt)) continue;
        if (previous.trial.provenance && !trial.provenance || previous.trial.lesson && !trial.lesson) throw new Error("outcome_export_conflict");
        if (Object.keys(previous.trial.results).some(phase => !trial.results[phase as keyof typeof trial.results])) throw new Error("outcome_export_conflict");
      }
      records.set(trial.id, { trial, exportedAt: file.exportedAt });
    }
  }
  return { version: 1, assignment: outcomeAssignment([...records.values()].map(record => record.trial)), files: raw.length, duplicates, summary: summarizeOutcomes([...records.values()].map(record => record.trial)),
    limitations: ["统计单位是去重后的验证记录，不是已核实身份的独立参与者。", "个人记录由参与者选择；研究票据记录的分配须另与冻结清单核对。该描述性汇总不进行随机研究的意向性分析。", "独立作答由参与者自报；文字解释尚待人工复核。", "重复练习与不满足同模型条件的记录保留，但不纳入首次独立对照。"],
  };
}

/** Only for explicitly supplied exports. Summary callers do not gain raw-answer fields. */
export function validatedOutcomeTrials(raw: unknown[]): OutcomeView[] {
  mergeOutcomeExports(raw);
  const files = raw.map(value => outcomeExportSchema.parse(value)).sort((a, b) => Date.parse(a.exportedAt) - Date.parse(b.exportedAt));
  const trials = new Map<string, OutcomeView>(); for (const file of files) for (const trial of file.trials) trials.set(trial.id, trial);
  return [...trials.values()];
}
