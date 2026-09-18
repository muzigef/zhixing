import { expect, it } from "vitest";
import { pairedEvaluation } from "../src/paired-evaluation.js";
const row = (caseId: string, repeat: number, arm: string, score: number, completed = true) => ({ caseId, repeat, arm, score, completed });
it("pairs exact repetitions and treats repeated answers to one question as one statistical unit", () => {
  const rows = [row("a", 1, "single", 0), row("a", 1, "team", 1), row("a", 2, "single", 1), row("a", 2, "team", 0), row("b", 1, "single", 0), row("b", 1, "team", 1)];
  const result = pairedEvaluation(rows, "single", "team");
  expect(result).toMatchObject({ pairs: 3, caseClusters: 2, meanDelta: 0.5, wins: 1, ties: 1, losses: 0 });
  expect(result.cases.find(item => item.caseId === "a")).toMatchObject({ pairs: 2, delta: 0 });
  expect(result.interpretation).toContain("同题重复");
});
it("does not silently fill missing pairs and counts incomplete delivered answers as zero", () => {
  const result = pairedEvaluation([row("a", 1, "single", 1), row("a", 1, "team", 1, false), row("b", 1, "single", 0), row("b", 2, "team", 1)], "single", "team");
  expect(result).toMatchObject({ pairs: 1, caseClusters: 1, unpairedRows: 2, meanDelta: -1, confidenceInterval95: null });
});
it("produces deterministic cluster intervals and an exact sign test without multiplying samples by repetitions", () => {
  const rows = Array.from({ length: 4 }, (_, index) => [row(String(index), 1, "single", 0), row(String(index), 1, "team", 1)]).flat();
  const result = pairedEvaluation(rows, "single", "team");
  expect(result).toMatchObject({ confidenceInterval95: [1, 1], signTest: { nonTiedCases: 4, twoSidedP: 0.125 } });
  expect(pairedEvaluation([...rows].reverse(), "single", "team")).toEqual(result);
  const replicated = rows.flatMap(item => [item, { ...item, repeat: 2 }, { ...item, repeat: 3 }]);
  expect(pairedEvaluation(replicated, "single", "team").signTest).toEqual(result.signTest);
});
it("rejects duplicate observations and invalid scores and returns no effect estimate for an unpaired experiment", () => {
  const sample = row("a", 1, "single", 1);
  expect(() => pairedEvaluation([sample, sample], "single", "team")).toThrow("paired_evaluation_duplicate");
  expect(() => pairedEvaluation([{ ...sample, score: NaN }], "single", "team")).toThrow();
  expect(pairedEvaluation([sample], "single", "team")).toMatchObject({ pairs: 0, caseClusters: 0, meanDelta: null, confidenceInterval95: null });
});
