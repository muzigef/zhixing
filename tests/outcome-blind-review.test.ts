import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { outcomeCalibration } from "../src/outcome-calibration.js";
import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createBlindReviewPacket } from "../src/outcome-blind-review.js";
const date = "2026-09-09T00:00:00.000Z";
const trial = { id: randomUUID(), topicId: "rag", mode: "zhixing", bankVersion: 1, title: "合成评估", stage: "abandoned", repeated: false, createdAt: date, questions: [], results: { pre: { answers: [-1, -1, -1], explanation: "合成解释，需要按资料核验数字。", assistance: "independent", formId: 0, correctCount: 0, total: 3, submittedAt: date, elapsedMs: 1000, explanationReview: "pending_human_review" } } };
const exported = () => ({ version: 1, exportedAt: date, topicId: "rag", assignment: "learner_selected", trials: [structuredClone(trial)] });
it("separates grading content from source identities, scores, phases and treatment metadata", () => {
  const result = createBlindReviewPacket(exported());
  const serialized = JSON.stringify(result.packet);
  for (const forbidden of [trial.id, '"mode"', '"phase"', '"provider"', '"correctCount"', '"assistance"', '"submittedAt"']) expect(serialized).not.toContain(forbidden);
  expect(result.packet.items[0]?.explanation).toBe(trial.results.pre.explanation);
  expect(result.packet.items[0]?.questions).toHaveLength(3);
  expect(result.coordinator.entries[0]).toMatchObject({ trialId: trial.id, phase: "pre", expectedRevision: 0, explanationSourceHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(createBlindReviewPacket(exported()).packet.items[0]?.id).not.toBe(result.packet.items[0]?.id);
});
it("rejects forged scores and withholds active studies until the attempt is closed", () => {
  const forged = exported(); forged.trials[0]!.results.pre.correctCount = 3;
  expect(() => createBlindReviewPacket(forged)).toThrow("outcome_export_invalid_score");
  const active = exported(); active.trials[0]!.stage = "lesson";
  expect(createBlindReviewPacket(active).packet.items).toEqual([]);
});
it("imports two blind raters together without overwriting history and rejects stale source/revision or duplicates", async () => {
  const { importOutcomeBlindReviews } = await import("../src/outcome-blind-review.js");
  const source = exported(), pack = createBlindReviewPacket(source);
  const rating = (reviewer: string, verdict: string) => ({ version: 1, packetHash: pack.coordinator.packetHash, reviewer, ratings: [{ itemId: pack.packet.items[0]!.id, verdict, feedback: "合成夹具：根据解释原文给出判断。" }] });
  const responses = [rating("reviewer-a", "supported"), rating("reviewer-b", "partial")];
  const result = importOutcomeBlindReviews(source, pack.packet, pack.coordinator, responses, "2026-09-18T00:00:00.000Z");
  expect(result.trials[0]!.results.pre?.reviews?.map(review => [review.reviewer, review.revision])).toEqual([["reviewer-a", 1], ["reviewer-b", 2]]);
  expect(outcomeCalibration(result.trials).reviewerAgreement[0]).toMatchObject({ reviewerA: "reviewer-a", reviewerB: "reviewer-b", agreement: { pairs: 1, exactAgreement: 0, meanDifferenceBMinusA: -2 } });
  expect(source.trials[0]!.results.pre.explanationReview).toBe("pending_human_review");
  expect(() => importOutcomeBlindReviews(result, pack.packet, pack.coordinator, responses)).toThrow("outcome_blind_source_changed");
  expect(() => importOutcomeBlindReviews(source, pack.packet, pack.coordinator, [responses[0], responses[0]])).toThrow("outcome_blind_duplicate");
  expect(() => importOutcomeBlindReviews(source, pack.packet, pack.coordinator, [{ ...responses[0], ratings: [{ ...responses[0]!.ratings[0], itemId: randomUUID() }] }])).toThrow("outcome_blind_item_unknown");
});

it("imports blind outcome responses through the CLI into a new export, leaving source and live data unchanged", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "outcome-blind-import-"));
  try {
    const source = exported(), pack = createBlindReviewPacket(source);
    const response = [{ version: 1, packetHash: pack.coordinator.packetHash, reviewer: "synthetic-reviewer", ratings: [{ itemId: pack.packet.items[0]!.id, verdict: "partial", feedback: "合成评分夹具，仅验证文件导入。" }] }];
    for (const [name, value] of Object.entries({ export: source, packet: pack.packet, coordinator: pack.coordinator, responses: response })) await fs.writeFile(path.join(root, `${name}.json`), JSON.stringify(value));
    const args = ["--import", "tsx", "scripts/import-outcome-reviews.ts", ...["export", "packet", "coordinator", "responses"].map(name => `--${name}=${path.join(root, `${name}.json`)}`), `--output=${path.join(root, "reviewed.json")}`];
    const result = await promisify(execFile)(process.execPath, args, { timeout: 10_000 });
    expect(JSON.parse(result.stdout)).toMatchObject({ liveDatabaseModified: false, calibration: { reviews: { singleReviewed: 1 } } });
    expect(JSON.parse(await fs.readFile(path.join(root, "export.json"), "utf8"))).toEqual(source);
    await expect(promisify(execFile)(process.execPath, args, { timeout: 10_000 })).rejects.toMatchObject({ code: 1 });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
it("retains separate transfer responses and reviewer declarations through blind import", async () => {
  const { importOutcomeBlindReviews } = await import("../src/outcome-blind-review.js");
  const source = exported(); Object.assign(source.trials[0]!.results.pre, { transferExample: "合成的新场景", transferPrompt: "请给出新例子" });
  const pack = createBlindReviewPacket(source);
  expect(pack.packet.items[0]).toMatchObject({ transferExample: "合成的新场景", transferPrompt: "请给出新例子" });
  const response = [{ version: 1, packetHash: pack.coordinator.packetHash, reviewer: "fixture", declaration: { kind: "human", independent: true }, ratings: [{ itemId: pack.packet.items[0]!.id, verdict: "partial", transferVerdict: "unsupported", feedback: "合成评分，新场景仍有遗漏。" }] }];
  const result = importOutcomeBlindReviews(source, pack.packet, pack.coordinator, response);
  expect(result.trials[0]!.results.pre!.reviews![0]).toMatchObject({ transferVerdict: "unsupported", declaration: { kind: "human", independent: true } });
  expect(() => importOutcomeBlindReviews(source, pack.packet, pack.coordinator, [{ ...response[0], declaration: { kind: "development_assistant", independent: true } }])).toThrow();
});
