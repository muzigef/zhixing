import type { ModelUsage } from "./model.js";
import type { TeamSnapshot } from "./team-contracts.js";
import { verifyTeam } from "./team-verification.js";

export interface StageRequest { phase: "planning" | "member" | "review" | "followup" | "answer"; durationMs: number; completed: boolean; usage?: ModelUsage; reportIssue?: string; }
const cost = (requests: readonly StageRequest[]) => ({ requests: requests.length, completed: requests.filter(item => item.completed).length,
  summedRequestMs: requests.reduce((sum, item) => sum + item.durationMs, 0), knownInputTokens: requests.reduce((sum, item) => sum + (item.usage?.inputTokens ?? 0), 0), knownOutputTokens: requests.reduce((sum, item) => sum + (item.usage?.outputTokens ?? 0), 0), unknownUsageRequests: requests.filter(item => !item.usage).length });
/** Describes execution and review coverage. No stage is graded semantically by its schema. */
export function teamStageDiagnostics(requests: readonly StageRequest[], snapshot?: TeamSnapshot) {
  const stages = (["planning", "member", "review", "followup", "answer"] as const).map(phase => {
    const selected = requests.filter(item => item.phase === phase);
    return { phase, ...cost(selected), reportShapeFailures: selected.filter(item => item.reportIssue).length };
  });
  const firstFollowup = requests.findIndex(item => item.phase === "followup");
  const correctionRequests = requests.filter((item, index) => item.phase === "followup" || firstFollowup >= 0 && index > firstFollowup && item.phase === "review");
  const followup = snapshot?.review?.followUp;
  const original = followup ? snapshot?.members[followup.member - 1]?.report : undefined;
  const changedClaimValues = original && followup?.report ? followup.report.claims.filter(claim => {
    const prior = original.claims.find(item => item.key.toLowerCase() === claim.key.toLowerCase()); return prior && prior.value !== claim.value;
  }).length : null;
  const packet = snapshot?.packet;
  return { version: 1, stages, correction: { ...cost(correctionRequests), followupRequests: correctionRequests.filter(item => item.phase === "followup").length, recheckRequests: correctionRequests.filter(item => item.phase === "review").length, changedClaimValues, originalUncertainties: original?.uncertainties.length ?? null, followupUncertainties: followup?.report?.uncertainties.length ?? null },
    packet: packet ? { hash: packet.hash, truncated: packet.truncated, retainedHistoryMessages: packet.history.length, sourceMessages: packet.context?.sourceMessages ?? null, omittedMessages: packet.context?.omittedMessages ?? null, omittedCharacters: packet.context?.omittedCharacters ?? null, retainedAnchors: packet.context?.anchors.items.length ?? null, omittedAnchors: packet.context?.anchors.omittedStatements ?? null } : null,
    acceptance: snapshot ? verifyTeam(snapshot) : null, planning: snapshot?.planning ?? null, reviewVerdict: snapshot?.review?.recheck?.verdict ?? snapshot?.review?.verdict ?? null,
    semanticQuality: "requires_review", interpretation: "阶段完成、报告格式和验收关联不等于语义正确。请求耗时相加包含并发工作，不等于墙钟等待。复核成本含 followup 及随后 review；结论变化和未决项减少不自动代表改善，未知用量单列。" };
}
