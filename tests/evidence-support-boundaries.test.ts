import { expect, it } from "vitest";
import { inspectEvidenceSupport, evidenceRepairReason } from "../src/evidence-support.js";
const citation = { topicId: "rag", documentId: "synthetic", documentName: "measurements.md", pageNumber: null, anchor: "experiment" };
const marker = "[measurements.md#anchor=experiment]";
const inspect = (answer: string, source: string) => inspectEvidenceSupport(answer + marker, [{ citation, text: source, score: 1 }]);
it("checks each metric separately and accepts a supported multi-metric answer", () => {
  const source = "成本降低 20%，延迟降低 10%。";
  expect(inspect("成本降低 20%，延迟降低 10%。", source).issues).toEqual([]);
  expect(evidenceRepairReason(inspect("成本降低 10%，延迟降低 20%。", source))).toBeTruthy();
});
it("rejects reversed measurement direction, changed percentile and changed relation", () => {
  expect(inspect("成本降低 20%。", "成本增加 20%。").issues.map(i => i.code)).toContain("contradicted_measurement");
  expect(inspect("P95 延迟是 80 毫秒。", "P50 延迟是 80 毫秒。").issues.map(i => i.code)).toContain("unsupported_quantity");
  expect(inspect("成本降低 20%。", "成本降至 20%。").issues.map(i => i.code)).toContain("contradicted_measurement");
});
it("flags dropping a measurement condition and rejects an explicit opposing condition", () => {
  const source = "仅在缓存命中时，延迟降低 20%。";
  expect(inspect("延迟降低 20%。", source).issues.map(i => i.code)).toContain("condition_unverified");
  expect(evidenceRepairReason(inspect("延迟降低 20%。", source))).toBeTruthy();
  expect(inspect("缓存命中时，延迟降低 20%。", source).issues).toEqual([]);
  expect(inspect("未命中缓存时，延迟降低 20%。", source).issues.map(i => i.code)).toContain("condition_unverified");
});
it("does not let examples, questions or explicitly unmeasured source quantities establish facts", () => {
  expect(evidenceRepairReason(inspect("成本降低 20%。", "尚未验证成本降低 20%。"))).toBeTruthy();
  expect(evidenceRepairReason(inspect("成本降低 20%。", "假设成本降低 20%。"))).toBeTruthy();
  expect(evidenceRepairReason(inspect("成本降低 20%。", "成本降低 20% 吗？"))).toBeTruthy();
});
it("keeps conservative English, quoted denials and supported negation from false blocking", () => {
  const source = "The cost reduction has not been measured. Cache hits do not guarantee freshness.";
  expect(inspect("The source cannot establish a cost reduction of 20%.", source).issues).toEqual([]);
  expect(inspect("We don’t confirm a cost reduction of 0.5%.", source).issues).toEqual([]);
  expect(evidenceRepairReason(inspect("We cannot prove a cost reduction of 0.5%, but latency decreased 30%.", source))).toBeTruthy();
  expect(inspect("Cache hits do not always mean fresh content.", source).issues).toEqual([]);
  expect(inspect("不能证明成本降低 20%，但是延迟降低 30%。", source).issues.map(i => i.code)).toContain("unsupported_quantity");
});
it("keeps limitations explicit and does not claim a broad semantic entailment oracle", () => {
  const report = inspect("相关性不能证明因果性。", "Correlation does not prove causation.");
  expect(report.notice).toContain("不代表语义蕴含");
  expect(report.issues).toEqual([]);
});

it("does not borrow a denied number or reverse a before/after pair", () => {
  expect(evidenceRepairReason(inspect("成本降低 20%。", "成本没有降低 20%。"))).toBeTruthy();
  expect(evidenceRepairReason(inspect("成本从 80 元降低至 100 元。", "成本从 100 元降低至 80 元。"))).toBeTruthy();
  expect(inspect("延迟降低 20%。", "成本尚未测量，延迟降低 20%。").issues).toEqual([]);
});
it("enforces condition preservation through the grounded-answer production entry point", async () => {
  const { answerFromEvidence } = await import("../src/grounded-answer.js");
  const { providerRuntime } = await import("../src/assistant-runtime.js");
  const client = { async *stream() { yield { type: "text_delta" as const, text: "延迟降低 20%。" + marker }; yield { type: "done" as const }; } };
  const answer = await answerFromEvidence(providerRuntime("mock", client), "延迟变化是多少？", [{ citation, text: "仅在缓存命中时，延迟降低 20%。", score: 1 }], true, new AbortController().signal);
  expect(answer).toContain("insufficient_evidence"); expect(answer).toContain("适用条件");
});
it("accepts a verifiable same-metric difference and percentage from a cited before/after pair", () => {
  const source = "固定合成实验中，仅在缓存命中时，P50 延迟从 100 毫秒降至 80 毫秒。";
  const answer = "固定合成实验中，缓存命中请求的 P50 延迟从 100 毫秒降至 80 毫秒，即减少 20 毫秒、下降 20%。";
  expect(inspect(answer, source).issues).toEqual([]);
  expect(evidenceRepairReason(inspect(answer.replace("下降 20%", "下降 80%"), source))).toBeTruthy();
  expect(evidenceRepairReason(inspect(answer.replace("减少 20 毫秒", "减少 30 毫秒"), source))).toBeTruthy();
  expect(evidenceRepairReason(inspect("成本降低 20%。", source))).toBeTruthy();
});
it("does not compute percentages from zero or mixed units and requires rounding to be declared", () => {
  expect(evidenceRepairReason(inspect("成本从 0 元增至 20 元，即增加 20%。", "成本从 0 元增至 20 元。"))).toBeTruthy();
  expect(evidenceRepairReason(inspect("延迟从 2 秒降至 80 毫秒，即降低 3900%。", "延迟从 2 秒降至 80 毫秒。"))).toBeTruthy();
  expect(inspect("成本从 3 元降至 2 元，即降低约 33.3%。", "成本从 3 元降至 2 元。").issues).toEqual([]);
  expect(evidenceRepairReason(inspect("成本从 3 元降至 2 元，即降低 33.3%。", "成本从 3 元降至 2 元。"))).toBeTruthy();
});
it("keeps an immediately attached comparison qualifier after a semicolon without accepting a universal claim", () => {
  const source = "仅在缓存命中时，P50 延迟从 100 毫秒降至 80 毫秒。";
  expect(inspect("P50 延迟从 100 毫秒降至 80 毫秒，即减少 20 毫秒、下降 20%；这一比较仅适用于缓存命中的请求。", source).issues).toEqual([]);
  expect(evidenceRepairReason(inspect("所有请求的 P50 延迟均从 100 毫秒降至 80 毫秒；这一比较仅适用于缓存命中的请求。", source))).toBeTruthy();
});
it("accepts an adjacent explicit qualifier for the same citation without borrowing an unrelated qualifier", () => {
  const source = [{ citation, text: "仅在缓存命中时，P50 延迟从 100 毫秒降至 80 毫秒。", score: 1 }];
  const first = `P50 延迟从 100 毫秒降至 80 毫秒，即减少 20 毫秒、下降 20%。${marker}`;
  const qualified = `${first}\n\n该比较仅适用于缓存命中的请求，不包含未命中请求。${marker}`;
  expect(inspectEvidenceSupport(qualified, source).issues).toEqual([]);
  expect(evidenceRepairReason(inspectEvidenceSupport(qualified.replace(`请求。${marker}`, "请求。[other.md#anchor=another]"), source))).toBeTruthy();
  expect(evidenceRepairReason(inspectEvidenceSupport(qualified.replace("仅适用于", "不仅适用于"), source))).toBeTruthy();
  expect(evidenceRepairReason(inspectEvidenceSupport(qualified.replace("P50 延迟", "所有请求的 P50 延迟"), source))).toBeTruthy();
});
