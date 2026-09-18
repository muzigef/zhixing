import { randomInt, randomUUID } from "node:crypto";
import { z } from "zod/v4";
import type { QualityReport } from "./quality-evaluation.js";
import { qualityReportHash, qualityReviewSchema, reviewQuality, type QualityReview } from "./quality-review.js";
import { explanationRubric, explanationDimensionNames, explanationDimensionsSchema } from "./explanation-rubric.js";
import { sourceHash } from "./source-version.js";
import { ordinalAgreement } from "./ordinal-agreement.js";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const itemSchema = z.object({ id: z.string().uuid(), prompt: z.string().max(128_000), text: z.string().max(100_000), criteria: z.array(z.string().min(1).max(2000)).min(1).max(48), context: z.array(z.object({ label: z.string().max(100), text: z.string().max(24_000) }).strict()).max(64) }).strict();
const packetSchema = z.object({ version: z.literal(1), rubric: z.unknown(), notice: z.string().max(2000), items: z.array(itemSchema).max(96) }).strict();
const coordinatorSchema = z.object({ version: z.literal(1), reportHash: hash, packetHash: hash, entries: z.array(z.object({ itemId: z.string().uuid(), provider: z.string().min(1).max(128), id: z.string().min(1).max(64), repetition: z.number().int().min(1).max(2), rowHash: hash }).strict()).max(96) }).strict();
const responseSchema = z.object({ version: z.literal(1), packetHash: hash, reviewer: qualityReviewSchema.shape.reviewer, ratings: z.array(z.object({ itemId: z.string().uuid(), criteria: z.array(z.enum(["pass", "partial", "fail"])).min(1).max(48), dimensions: explanationDimensionsSchema, rationale: z.string().trim().min(1).max(4000), failures: z.array(z.enum(["accuracy", "grounding", "format", "repetition", "unnecessary_question", "execution", "other"])).max(7), guessedProvider: z.string().trim().min(1).max(128).optional() }).strict()).max(96) }).strict();
function itemFor(row: QualityReport["results"][number], id: string) {
  const context: { label: string; text: string }[] = (row.seed ?? []).map(item => ({ label: item.role, text: item.text }));
  for (const item of row.summaryEvidence?.sourceMessages ?? []) context.push({ label: item.role, text: item.text });
  // Keep evidence content, not treatment phase, retrieval scores, hashes or model identities.
  const rag = z.object({ ragEvidence: z.object({ evidence: z.array(z.object({ text: z.string().max(24_000) })).max(12) }).optional() }).safeParse(row);
  for (const [index, item] of (rag.success ? rag.data.ragEvidence?.evidence ?? [] : []).entries()) context.push({ label: `source-${index + 1}`, text: item.text });
  return itemSchema.parse({ id, prompt: row.prompt, text: row.text, criteria: row.criteria, context });
}
export function createQualityBlindPacket(report: QualityReport) {
  const rows = report.results.filter(row => row.attempted && ["completed", "waiting"].includes(row.status));
  const keys = rows.map(row => JSON.stringify([row.provider, row.id, row.repetition])); if (new Set(keys).size !== keys.length || rows.length > 96) throw new Error("blind_duplicate");
  const items = rows.map(row => itemFor(row, randomUUID()));
  const entries = rows.map((row, index) => ({ itemId: items[index]!.id, provider: row.provider, id: row.id, repetition: row.repetition, rowHash: sourceHash(JSON.stringify(row)) }));
  for (let i = items.length - 1; i > 0; i--) { const j = randomInt(i + 1); [items[i], items[j]] = [items[j]!, items[i]!]; }
  const packet = packetSchema.parse({ version: 1, rubric: explanationRubric, notice: "独立评阅三项维度和逐项标准；不要查看负责人映射或其他人的评分。原文可能自报模型身份，匿名无法保证。缺少必要证据时注明，不猜测；分享前由负责人检查原文隐私。", items });
  return { packet, coordinator: { version: 1 as const, reportHash: qualityReportHash(report), packetHash: sourceHash(JSON.stringify(packet)), entries } };
}
export function importQualityBlindReview(report: QualityReport, rawPacket: unknown, rawCoordinator: unknown, rawResponse: unknown) {
  const packet = packetSchema.parse(rawPacket), coordinator = coordinatorSchema.parse(rawCoordinator), response = responseSchema.parse(rawResponse);
  if (coordinator.reportHash !== qualityReportHash(report)) throw new Error("blind_report_mismatch");
  if (sourceHash(JSON.stringify(packet)) !== coordinator.packetHash || response.packetHash !== coordinator.packetHash || JSON.stringify(packet.rubric) !== JSON.stringify(explanationRubric)) throw new Error("blind_packet_mismatch");
  const expectedRows = report.results.filter(row => row.attempted && ["completed", "waiting"].includes(row.status));
  if (packet.items.length !== coordinator.entries.length || packet.items.length !== expectedRows.length) throw new Error("blind_packet_mismatch");
  const ids = new Set<string>(), rowKeys = new Set<string>();
  for (const entry of coordinator.entries) {
    const key = JSON.stringify([entry.provider, entry.id, entry.repetition]);
    if (ids.has(entry.itemId) || rowKeys.has(key)) throw new Error("blind_duplicate"); ids.add(entry.itemId); rowKeys.add(key);
    const row = expectedRows.find(row => row.provider === entry.provider && row.id === entry.id && row.repetition === entry.repetition);
    const items = packet.items.filter(item => item.id === entry.itemId);
    if (!row || sourceHash(JSON.stringify(row)) !== entry.rowHash || items.length !== 1 || JSON.stringify(items[0]) !== JSON.stringify(itemFor(row, entry.itemId))) throw new Error("blind_source_mismatch");
  }
  let guesses = 0, matchingGuesses = 0; const seen = new Set<string>();
  const scores = response.ratings.map(rating => {
    if (seen.has(rating.itemId)) throw new Error("blind_duplicate"); seen.add(rating.itemId);
    const entry = coordinator.entries.find(entry => entry.itemId === rating.itemId); if (!entry) throw new Error("blind_item_unknown");
    if (rating.guessedProvider) { guesses++; if (rating.guessedProvider === entry.provider) matchingGuesses++; }
    return { provider: entry.provider, id: entry.id, repetition: entry.repetition, criteria: rating.criteria, dimensions: rating.dimensions, rationale: rating.rationale, failures: rating.failures };
  });
  return { review: reviewQuality(report, { version: 2, rubricVersion: "explanation-v1", reportHash: coordinator.reportHash, reviewer: response.reviewer, scores }), blindness: { guaranteed: false, guesses, matchingGuesses, unguessed: response.ratings.length - guesses, interpretation: "只统计自报猜测；匹配不证明泄露，未匹配不证明独立。" } };
}
function revalidate(report: QualityReport, review: QualityReview) {
  return reviewQuality(report, { ...review, scores: review.scores.map(({ criteriaVerdict, verdict, ...score }) => { void criteriaVerdict; void verdict; return score; }) });
}
export function compareQualityReviewers(report: QualityReport, rawA: QualityReview, rawB: QualityReview) {
  const a = revalidate(report, rawA), b = revalidate(report, rawB);
  if (a.reviewer.name.normalize("NFKC").trim().toLowerCase() === b.reviewer.name.normalize("NFKC").trim().toLowerCase()) throw new Error("reviewers_not_distinct");
  const pairs = a.scores.flatMap(score => {
    const other = b.scores.find(item => item.provider === score.provider && item.id === score.id && item.repetition === score.repetition);
    return score.dimensions && other?.dimensions ? [{ a: score, b: other }] : [];
  });
  const dimensions = (items: typeof pairs) => Object.fromEntries(explanationDimensionNames.map(name => [name, ordinalAgreement(items.map(pair => [pair.a.dimensions![name].score, pair.b.dimensions![name].score] as const))])) as Record<typeof explanationDimensionNames[number], ReturnType<typeof ordinalAgreement>>;
  return { reviewerA: a.reviewer, reviewerB: b.reviewer, pairedItems: pairs.length, unpairedRatings: a.scores.length + b.scores.length - pairs.length * 2, dimensions: dimensions(pairs), byProvider: [...new Set(pairs.map(pair => pair.a.provider))].sort().map(provider => ({ provider, dimensions: dimensions(pairs.filter(pair => pair.a.provider === provider)) })), interpretation: "只比较双方都完成三维评分的同一回答；方向差为B减A，按组检查系统偏差。一致性不等于真值，常数评分时机会校正分母为零，kappa 为空。身份/独立性为声明；小样本与同题重复不能证明人群一致性。" };
}
