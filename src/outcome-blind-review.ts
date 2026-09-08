import { createHash, randomUUID, randomInt } from "node:crypto";
import { outcomeExportSchema, type OutcomePhase } from "./outcome-contracts.js";
import { mergeOutcomeExports } from "./outcome-report.js";
import { explanationSourceHash } from "./outcome-calibration.js";
import { outcomeBank } from "./outcome-bank.js";

/** Explicit, validated exports only. Never mutate the study or invent a rating. */
export function createBlindReviewPacket(raw: unknown) {
  const exported = outcomeExportSchema.parse(raw); mergeOutcomeExports([exported]);
  const items: { id: string; goal: string; questions: { title: string; choices: string[]; selected: number }[]; explanation: string }[] = [];
  const entries: { itemId: string; trialId: string; topicId: string; phase: OutcomePhase; explanationSourceHash: string; expectedExplanation: string; expectedRevision: number }[] = [];
  for (const trial of exported.trials) {
    if (!["complete", "abandoned"].includes(trial.stage)) continue;
    const bank = outcomeBank[trial.topicId]!;
    for (const phase of ["pre", "post", "delayed"] as const) {
      const result = trial.results[phase]; if (!result) continue;
      const id = randomUUID();
      items.push({ id, goal: bank.goal, questions: bank.forms[result.formId]!.map((question, index) => ({ title: question.title, choices: question.choices, selected: result.answers[index]! })), explanation: result.explanation });
      entries.push({ itemId: id, trialId: trial.id, topicId: trial.topicId, phase, explanationSourceHash: explanationSourceHash(trial, phase, result), expectedExplanation: result.explanation, expectedRevision: result.reviews?.length ?? 0 });
    }
  }
  for (let i = items.length - 1; i > 0; i--) { const j = randomInt(i + 1); [items[i], items[j]] = [items[j]!, items[i]!]; }
  const packet = { version: 1, notice: "独立阅读后记录 supported / partial / unsupported 及具体依据。请勿猜测模型或学习方式。文字原文可能包含参与者自行披露的信息，负责人应在分享前检查。此包不包含自动分数、阶段或其他人的评分。", items };
  return { packet, coordinator: { version: 1, packetHash: createHash("sha256").update(JSON.stringify(packet)).digest("hex"), notice: "只交给研究负责人；不要随评阅包发给评阅者。此映射不构成已完成的人类评价。录入前核对原文哈希和当前修订号，评分者身份由负责人确认。", entries } };
}
