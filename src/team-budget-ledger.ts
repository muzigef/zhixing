import { z } from "zod/v4";
import type { TeamSnapshot } from "./team-contracts.js";
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const budgetUsageSchema = z.object({ inputTokens: count, outputTokens: count });
const counters = z.object({ inputTokens: count, outputTokens: count, estimatedInputTokens: count, reservedOutputTokens: count, unknownUsageRequests: count });
export const teamBudgetLedgerSchema = z.object({
  version: z.literal(1), baseline: counters,
  entries: z.array(z.object({ key: z.string().max(4096), native: z.boolean(), rawInput: count, inputReserved: count, outputReserved: count, usage: budgetUsageSchema.optional() }).strict()).max(24),
}).strict();
export function teamBudgetAccounting(state: TeamSnapshot) {
  const ledger = state.budgetLedger;
  const base = ledger?.baseline ?? state;
  let knownInputTokens = base.inputTokens, outputTokens = base.outputTokens;
  let unknownInputReserved = base.unknownUsageRequests ? base.estimatedInputTokens : 0;
  let reservedOutputTokens = base.reservedOutputTokens, estimatedInputTokens = base.estimatedInputTokens, unknownUsageRequests = base.unknownUsageRequests;
  for (const entry of ledger?.entries ?? []) {
    estimatedInputTokens += entry.rawInput;
    reservedOutputTokens += entry.usage?.outputTokens ?? entry.outputReserved;
    if (entry.usage) { knownInputTokens += entry.usage.inputTokens; outputTokens += entry.usage.outputTokens; }
    else { unknownInputReserved += entry.inputReserved; unknownUsageRequests++; }
  }
  if (ledger && (knownInputTokens !== state.inputTokens || outputTokens !== state.outputTokens || estimatedInputTokens !== state.estimatedInputTokens || reservedOutputTokens !== state.reservedOutputTokens || unknownUsageRequests !== state.unknownUsageRequests)) throw new Error("team_budget_ledger_mismatch");
  return { knownInputTokens, accountedInputTokens: knownInputTokens + unknownInputReserved, unknownInputReserved, unknownUsageRequests, reservedOutputTokens, legacyAmbiguous: base.unknownUsageRequests > 0 };
}
export function ensureBudgetLedger(state: TeamSnapshot) {
  teamBudgetAccounting(state);
  return state.budgetLedger ??= { version: 1, baseline: counters.parse(state), entries: [] };
}
export function calibratedInputReservation(state: TeamSnapshot, key: string, raw: number): number {
  let ratio = 1, overhead = 0;
  for (const entry of state.budgetLedger?.entries ?? []) if (entry.key === key && entry.usage) {
    ratio = Math.max(ratio, Math.min(4, entry.usage.inputTokens / Math.max(1, entry.rawInput)));
    overhead = Math.max(overhead, entry.usage.inputTokens - entry.rawInput);
  }
  return Math.max(raw, Math.ceil(raw * ratio), raw + overhead);
}

export function teamBudgetLabel(state: TeamSnapshot): string {
  try { const report = teamBudgetAccounting(state); return `输入核算 ${report.accountedInputTokens} token（已报告 ${report.knownInputTokens} + 未知预留 ${report.unknownInputReserved}）；输出已耗用及预留 ${report.reservedOutputTokens} token${report.legacyAmbiguous ? "。旧记录缺少逐请求明细，采用保守预留" : ""}。估算不等于账单硬上限。`; }
  catch { return "预算记录不一致，继续调用前需要核对。"; }
}
