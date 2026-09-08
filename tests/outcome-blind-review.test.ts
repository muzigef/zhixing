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
