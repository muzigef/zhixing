import { z } from "zod/v4";
import { sourceHash } from "./source-version.js";
const blindPacketSchema = z.object({ version: z.literal(1), notice: z.string().max(2000), items: z.array(z.object({ id: z.string().uuid(), goal: z.string().max(2000), questions: z.array(z.object({ title: z.string().max(2000), choices: z.array(z.string().max(2000)).length(3), selected: z.number().int().min(-1).max(2) }).strict()).length(3), explanation: z.string().max(2000), transferExample: z.string().max(2000).optional(), transferPrompt: z.string().max(1000).optional() }).strict()).max(150) }).strict();
const blindCoordinatorSchema = z.object({ version: z.literal(1), packetHash: z.string().regex(/^[a-f0-9]{64}$/), notice: z.string().max(2000), entries: z.array(z.object({ itemId: z.string().uuid(), trialId: z.string().uuid(), topicId: z.enum(["agent-development", "rag"]), phase: z.enum(["pre", "post", "delayed"]), explanationSourceHash: z.string().regex(/^[a-f0-9]{64}$/), expectedExplanation: z.string().max(2000), expectedRevision: z.number().int().min(0).max(100) }).strict()).max(150) }).strict();
const blindResponseSchema = z.object({ version: z.literal(1), packetHash: z.string().regex(/^[a-f0-9]{64}$/), reviewer: z.string().trim().min(1).max(100), declaration: reviewerDeclarationSchema.optional(), ratings: z.array(z.object({ itemId: z.string().uuid(), verdict: z.enum(["supported", "partial", "unsupported"]), transferVerdict: z.enum(["supported", "partial", "unsupported"]).optional(), feedback: z.string().trim().min(1).max(2000) }).strict()).max(150) }).strict();
import { createHash, randomUUID, randomInt } from "node:crypto";
import { outcomeExportSchema, reviewerDeclarationSchema, type OutcomePhase } from "./outcome-contracts.js";
import { mergeOutcomeExports } from "./outcome-report.js";
import { explanationSourceHash } from "./outcome-calibration.js";
import { outcomeBank } from "./outcome-bank.js";

/** Explicit, validated exports only. Never mutate the study or invent a rating. */
export function createBlindReviewPacket(raw: unknown) {
  const exported = outcomeExportSchema.parse(raw); mergeOutcomeExports([exported]);
  const items: { transferExample?: string; transferPrompt?: string; id: string; goal: string; questions: { title: string; choices: string[]; selected: number }[]; explanation: string }[] = [];
  const entries: { itemId: string; trialId: string; topicId: string; phase: OutcomePhase; explanationSourceHash: string; expectedExplanation: string; expectedRevision: number }[] = [];
  for (const trial of exported.trials) {
    if (!["complete", "abandoned"].includes(trial.stage)) continue;
    const bank = outcomeBank[trial.topicId]!;
    for (const phase of ["pre", "post", "delayed"] as const) {
      const result = trial.results[phase]; if (!result) continue;
      const id = randomUUID();
      items.push({ id, goal: bank.goal, questions: bank.forms[result.formId]!.map((question, index) => ({ title: question.title, choices: question.choices, selected: result.answers[index]! })), explanation: result.explanation, ...(result.transferExample !== undefined ? { transferExample: result.transferExample, transferPrompt: result.transferPrompt } : {}) });
      entries.push({ itemId: id, trialId: trial.id, topicId: trial.topicId, phase, explanationSourceHash: explanationSourceHash(trial, phase, result), expectedExplanation: result.explanation, expectedRevision: result.reviews?.length ?? 0 });
    }
  }
  for (let i = items.length - 1; i > 0; i--) { const j = randomInt(i + 1); [items[i], items[j]] = [items[j]!, items[i]!]; }
  const packet = { version: 1, notice: "独立阅读后记录 supported / partial / unsupported 及具体依据。请勿猜测模型或学习方式。文字原文可能包含参与者自行披露的信息，负责人应在分享前检查。此包不包含自动分数、阶段或其他人的评分。", items };
  return { packet, coordinator: { version: 1, packetHash: createHash("sha256").update(JSON.stringify(packet)).digest("hex"), notice: "只交给研究负责人；不要随评阅包发给评阅者。此映射不构成已完成的人类评价。录入前核对原文哈希和当前修订号，评分者身份由负责人确认。", entries } };
}

/** Import into an explicit export copy, all-or-nothing. Never writes the live learning database. */
export function importOutcomeBlindReviews(rawExport: unknown, rawPacket: unknown, rawCoordinator: unknown, rawResponses: unknown, now = new Date().toISOString()) {
  const exported = outcomeExportSchema.parse(rawExport); mergeOutcomeExports([exported]);
  const packet = blindPacketSchema.parse(rawPacket), coordinator = blindCoordinatorSchema.parse(rawCoordinator), responses = z.array(blindResponseSchema).min(1).max(10).parse(rawResponses);
  z.string().datetime().parse(now);
  if (sourceHash(JSON.stringify(packet)) !== coordinator.packetHash || responses.some(response => response.packetHash !== coordinator.packetHash)) throw new Error("outcome_blind_packet_changed");
  const eligible = exported.trials.filter(trial => ["complete", "abandoned"].includes(trial.stage));
  if (packet.items.length !== coordinator.entries.length || coordinator.entries.length !== eligible.reduce((sum, trial) => sum + Object.values(trial.results).filter(Boolean).length, 0)) throw new Error("outcome_blind_source_changed");
  const ids = new Set<string>(), keys = new Set<string>();
  for (const entry of coordinator.entries) {
    const key = JSON.stringify([entry.topicId, entry.trialId, entry.phase]);
    if (ids.has(entry.itemId) || keys.has(key)) throw new Error("outcome_blind_duplicate"); ids.add(entry.itemId); keys.add(key);
    const trial = eligible.find(trial => trial.id === entry.trialId && trial.topicId === entry.topicId), result = trial?.results[entry.phase];
    if (!trial || !result || result.explanation !== entry.expectedExplanation || (result.reviews?.length ?? 0) !== entry.expectedRevision || explanationSourceHash(trial, entry.phase, result) !== entry.explanationSourceHash) throw new Error("outcome_blind_source_changed");
    const bank = outcomeBank[trial.topicId]!;
    const expected = { id: entry.itemId, goal: bank.goal, questions: bank.forms[result.formId]!.map((question, index) => ({ title: question.title, choices: question.choices, selected: result.answers[index]! })), explanation: result.explanation, ...(result.transferExample !== undefined ? { transferExample: result.transferExample, transferPrompt: result.transferPrompt } : {}) };
    const items = packet.items.filter(item => item.id === entry.itemId);
    if (items.length !== 1 || JSON.stringify(items[0]) !== JSON.stringify(expected)) throw new Error("outcome_blind_source_changed");
  }
  const reviewers = new Set<string>();
  // All input checks precede mutation of this parsed copy; no partial output is persisted.
  for (const response of responses) {
    const name = response.reviewer.normalize("NFKC").trim().toLowerCase();
    if (reviewers.has(name)) throw new Error("outcome_blind_duplicate"); reviewers.add(name);
    const rated = new Set<string>();
    for (const rating of response.ratings) {
      if (rated.has(rating.itemId)) throw new Error("outcome_blind_duplicate"); rated.add(rating.itemId);
      if (!ids.has(rating.itemId)) throw new Error("outcome_blind_item_unknown");
      if (rating.transferVerdict && !packet.items.find(item => item.id === rating.itemId)?.transferExample) throw new Error("outcome_blind_transfer_missing");
    }
  }
  for (const response of responses) for (const rating of response.ratings) {
    const entry = coordinator.entries.find(entry => entry.itemId === rating.itemId)!;
    const trial = exported.trials.find(trial => trial.id === entry.trialId && trial.topicId === entry.topicId)!, result = trial.results[entry.phase]!;
    const reviews = result.reviews ?? [];
    if (reviews.length >= 100) throw new Error("outcome_review_limit");
    result.reviews = [...reviews, { reviewer: response.reviewer, verdict: rating.verdict, ...(response.declaration ? { declaration: response.declaration } : {}), ...(rating.transferVerdict ? { transferVerdict: rating.transferVerdict } : {}), feedback: rating.feedback, sourceHash: entry.explanationSourceHash, revision: reviews.length + 1, reviewedAt: now }];
    result.explanationReview = "human_reviewed";
  }
  const result = outcomeExportSchema.parse({ ...exported, exportedAt: now }); mergeOutcomeExports([result]); return result;
}
