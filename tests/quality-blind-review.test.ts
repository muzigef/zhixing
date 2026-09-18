import { expect, it } from "vitest";
import { evaluateQuality } from "../src/quality-evaluation.js";
import { createQualityBlindPacket, importQualityBlindReview, compareQualityReviewers } from "../src/quality-blind-review.js";
import { ordinalAgreement } from "../src/ordinal-agreement.js";
const fixture = async () => evaluateQuality([{ id: "PRIVATE_CASE", prompt: "解释2+2", criteria: ["加法正确"] }], ["PRIVATE_PROVIDER"], 1, async () => ({ status: "completed", text: "两个与两个合并，共四个。", model: "PRIVATE_MODEL" }));
const dim = (score: number) => ({ score, rationale: "合成评阅依据", quotes: ["共四个"] });
const response = (packet: ReturnType<typeof createQualityBlindPacket>["packet"], name = "synthetic-a", score = 4) => ({ version: 1, packetHash: "", reviewer: { name, kind: "development_assistant", independent: false }, ratings: packet.items.map(item => ({ itemId: item.id, criteria: ["pass"], dimensions: { correctness: dim(score), completeness: dim(score), clarity: dim(score) }, rationale: "合成评阅，不宣称独立人评", failures: [], guessedProvider: "PRIVATE_PROVIDER" })) });
it("hides identities and maps blind scores only after validating the exact packet, report and answer", async () => {
  const report = await fixture(), pack = createQualityBlindPacket(report);
  expect(JSON.stringify(pack.packet)).not.toMatch(/PRIVATE_CASE|PRIVATE_PROVIDER|PRIVATE_MODEL|startedAt/);
  const raw = { ...response(pack.packet), packetHash: pack.coordinator.packetHash };
  const result = importQualityBlindReview(report, pack.packet, pack.coordinator, raw);
  expect(result.review.scores[0]).toMatchObject({ provider: "PRIVATE_PROVIDER", id: "PRIVATE_CASE", verdict: "pass" });
  expect(result.blindness).toMatchObject({ guesses: 1, matchingGuesses: 1, guaranteed: false });
  expect(() => importQualityBlindReview(report, { ...pack.packet, items: [{ ...pack.packet.items[0]!, text: "changed" }] }, pack.coordinator, raw)).toThrow("blind_packet_mismatch");
  expect(() => importQualityBlindReview({ ...report, results: [{ ...report.results[0]!, text: "changed" }] }, pack.packet, pack.coordinator, raw)).toThrow("blind_report_mismatch");
  expect(() => importQualityBlindReview(report, pack.packet, pack.coordinator, { ...raw, ratings: [...raw.ratings, ...raw.ratings] })).toThrow("blind_duplicate");
});
it("reports disagreement and directional score differences using only shared rated items", async () => {
  const report = await fixture(), pack = createQualityBlindPacket(report);
  const reviews = [response(pack.packet, "a", 4), response(pack.packet, "b", 2)].map(raw => importQualityBlindReview(report, pack.packet, pack.coordinator, { ...raw, packetHash: pack.coordinator.packetHash }).review);
  const comparison = compareQualityReviewers(report, reviews[0]!, reviews[1]!);
  expect(comparison.dimensions.correctness).toMatchObject({ pairs: 1, exactAgreement: 0, meanDifferenceBMinusA: -2 });
  expect(comparison.byProvider[0]!.dimensions.clarity.meanAbsoluteDifference).toBe(2);
  expect(() => compareQualityReviewers(report, reviews[0]!, reviews[0]!)).toThrow("reviewers_not_distinct");
});
it("computes agreement with chance correction and handles constant or missing data honestly", () => {
  expect(ordinalAgreement([[0, 0], [1, 1], [4, 4]])).toMatchObject({ pairs: 3, exactAgreement: 1, quadraticWeightedKappa: 1 });
  expect(ordinalAgreement([[4, 4]])).toMatchObject({ exactAgreement: 1, quadraticWeightedKappa: null });
  expect(ordinalAgreement([])).toMatchObject({ pairs: 0, exactAgreement: null, quadraticWeightedKappa: null });
  expect(ordinalAgreement([[0, 4], [4, 0]]).quadraticWeightedKappa).toBe(-1);
  expect(() => ordinalAgreement([[5, 0]])).toThrow();
});
it("retains the actual RAG evidence needed for blind grading while hiding retrieval-arm metadata", async () => {
  const report = await fixture();
  Object.assign(report.results[0]!, { ragEvidence: { phase: "PRIVATE_PHASE", evidence: [{ text: "公开资料：仅在缓存命中时延迟降低。", score: .9, citation: { documentName: "synthetic.md" } }], retrieval: { mode: "PRIVATE_MODE" } } });
  const pack = createQualityBlindPacket(report);
  expect(pack.packet.items[0]!.context).toContainEqual({ label: "source-1", text: "公开资料：仅在缓存命中时延迟降低。" });
  expect(JSON.stringify(pack.packet)).not.toMatch(/PRIVATE_PHASE|PRIVATE_MODE|"score"/);
});
