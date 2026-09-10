import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { verifyTeam, validateReportEvidence, validateReviewChecks } from "../src/team-verification.js";
import { teamSnapshotSchema, type TeamSnapshot } from "../src/team-contracts.js";
import { teamReportSchema } from "../src/team-quality.js";

function fixture(): TeamSnapshot {
  const binding = { provider: "mock", model: "mock", connection: "local", reasoning: "balanced" };
  const report = { summary: "结论", claims: [{ key: "answer", value: "4", basis: "2+2" }], uncertainties: [] };
  return teamSnapshotSchema.parse({ id: randomUUID(), mode: "same-model-team", status: "completed", lead: binding, members: [{ id: randomUUID(), role: "reasoning-checker", binding, required: true, status: "completed", task: "计算", attempts: 1, report }], tasks: [{ id: randomUUID(), key: "derive", member: 1, goal: "计算", dependsOn: [], acceptance: ["核算"], status: "completed", attempts: 1, report }], modelTurns: 4, toolCalls: 0, reservedOutputTokens: 0, estimatedInputTokens: 0, inputTokens: 0, outputTokens: 0, unknownUsageRequests: 0, protocol: 3, review: { status: "completed", verdict: "ready", issues: [], guidance: "可用" } });
}
it("does not certify a ready vote without per-criterion coverage", () => {
  const state = fixture(); const result = verifyTeam(state);
  expect(result.status).toBe("unresolved"); expect(result.total).toBe(1); expect(result.covered).toBe(0); expect(result.issues.length).toBeGreaterThan(0);
});
it("separates model review from observed tool evidence and keeps uncertainty open", () => {
  const state = fixture(); state.review!.checks = [{ task: "derive", criterion: 0, status: "supported", claimKeys: ["answer"], evidenceIds: [], reason: "按题设计算" }];
  expect(verifyTeam(state).status).toBe("model-reviewed");
  state.tasks![0]!.report!.uncertainties = ["条件不明确"];
  expect(verifyTeam(state).status).toBe("unresolved");
});
it("rejects fabricated, failed or foreign task evidence and duplicate or missing criteria", () => {
  const state = fixture(); const receipt = { id: "a".repeat(64), executionId: randomUUID(), callId: "call1", tool: "learning_progress", inputHash: "b".repeat(64), outputHash: "c".repeat(64), ok: true };
  state.tasks![0]!.evidence = [receipt];
  const report = teamReportSchema.parse({ ...state.tasks![0]!.report, claims: [{ key: "answer", value: "4", basis: "工具输出", evidenceIds: [receipt.id] }] });
  expect(validateReportEvidence(report, [receipt])).toBeUndefined();
  expect(validateReportEvidence(report, [])).toBeDefined(); expect(validateReportEvidence(report, [{ ...receipt, ok: false }])).toBeDefined();
  state.tasks![0]!.report = report;
  const check = { task: "derive", criterion: 0, status: "supported" as const, claimKeys: ["answer"], evidenceIds: [receipt.id], reason: "与输出一致" };
  expect(validateReviewChecks([check], state.tasks!)).toBeUndefined();
  expect(validateReviewChecks([check, check], state.tasks!)).toBeDefined();
  expect(validateReviewChecks([{ ...check, task: "foreign" }], state.tasks!)).toBeDefined();
  expect(validateReviewChecks([{ ...check, criterion: 1 }], state.tasks!)).toBeDefined();
  state.review!.checks = [check]; expect(verifyTeam(state).status).toBe("evidence-linked");
  state.tasks![0]!.status = "failed"; expect(verifyTeam(state).status).toBe("unresolved");
});
it("allows an explicit corrected report to satisfy an earlier criterion without erasing the original uncertainty", () => {
  const state = fixture(); const original = state.tasks![0]!; original.report!.uncertainties = ["可能遗漏边界"];
  state.tasks!.push({ ...structuredClone(original), id: randomUUID(), key: "followup-1", kind: "followup", dependsOn: ["derive"], report: { summary: "补查后无遗漏", claims: [{ key: "fixed", value: "4", basis: "逐一核对边界" }], uncertainties: [] } });
  state.review!.checks = [
    { task: "derive", sourceTask: "followup-1", criterion: 0, status: "supported", claimKeys: ["fixed"], evidenceIds: [], reason: "补查结果覆盖原交付条件" },
    { task: "followup-1", criterion: 0, status: "supported", claimKeys: ["fixed"], evidenceIds: [], reason: "已补查" },
  ];
  expect(verifyTeam(state)).toMatchObject({ status: "model-reviewed", total: 2, covered: 2 });
  expect(original.report!.uncertainties).toEqual(["可能遗漏边界"]);
  state.review!.checks[0]!.sourceTask = "foreign";
  expect(verifyTeam(state).status).toBe("unresolved");
});
