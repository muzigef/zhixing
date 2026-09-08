import { outcomeExportSchema, type OutcomeView } from "./outcome-contracts.js";
import { outcomeBank } from "./outcome-bank.js";
import { summarizeOutcomes } from "./learning-outcomes.js";
import { validateExplanationReviews } from "./outcome-calibration.js";

/** Merge only explicitly exported records; identifiers survive backups so copies aren't new samples. */
export function mergeOutcomeExports(raw: unknown[]) {
  if (!raw.length || raw.length > 100) throw new Error("outcome_export_limit");
  const records = new Map<string, { trial: OutcomeView; exportedAt: string }>(); let duplicates = 0;
  for (const value of raw) {
    const file = outcomeExportSchema.parse(value);
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
  return { version: 1, assignment: "learner_selected", files: raw.length, duplicates, summary: summarizeOutcomes([...records.values()].map(record => record.trial)),
    limitations: ["统计单位是去重后的验证记录，不是已核实身份的独立参与者。", "学习方式由参与者选择；既往学习、题卷难度与学习时长未控制，结果不能证明因果效果。", "独立作答由参与者自报；文字解释尚待人工复核。", "重复练习与不满足同模型条件的记录保留，但不纳入首次独立对照。"],
  };
}
