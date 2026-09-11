import { createHash } from "node:crypto";
import path from "node:path";
import { AgentService } from "./agent-service.js";
import { AgentSessionStore, atomicJson } from "./agent-session-store.js";
import { bindAgentModel } from "./agent-model-binding.js";
import { capabilitiesFor } from "./model-capabilities.js";
import { publicError } from "./agent-errors.js";
import { teamConfigurationSchema, type ModelBinding } from "./team-contracts.js";
import { scoreTeamAnswer, teamDevelopmentCases, teamHoldoutCases, type TeamEvaluationCase } from "./team-evaluation-cases.js";
import type { AgentProvider } from "./agent-provider.js";
import type { ChatMessage } from "./agent-session-contracts.js";
import type { ContinuableModelClient, ModelEvent, ModelMessage, ModelRequestOptions, ModelUsage, ToolResultMessage } from "./model.js";
import { teamQualityCases } from "./team-quality-cases.js";
import { teamFailure, teamJsonRepairReason, teamReportSchema, teamReviewDecisionSchema, type TeamFailure } from "./team-quality.js";
import { isAgentExecutor, type AgentBackend } from "./agent-executor.js";
import type { ModelTiming } from "./model-telemetry.js";

export const evaluationArms = ["single-pi", "self-review-pi", "same-team", "mixed-team", "single-deepseek", "single-kimi", "single-codex", "self-review-codex"] as const;
export type EvaluationArm = typeof evaluationArms[number];
interface RequestRecord { transport?: "native-task"; outputLimit?: "observed"; firstOutputMs?: number; provider: AgentProvider; model?: string; phase: "planning" | "member" | "review" | "followup" | "answer"; durationMs: number; maxOutputTokens?: number; requestedReasoning?: string; timing?: ModelTiming; usage?: ModelUsage; completed: boolean; failureCode?: TeamFailure; reportIssue?: string; }
export interface EvaluationRow {
  caseId: string; repeat: number; arm: EvaluationArm; completed: boolean; error?: string; durationMs: number;
  firstTokenMs: number | null; firstOutputMs?: number | null; text: string; turns: ChatMessage[]; requests: RequestRecord[];
  grade: ReturnType<typeof scoreTeamAnswer>;
}
export interface EvaluationProgress { completed: number; total: number; caseId: string; arm: EvaluationArm; startedAt: string; }
const providerFor = (arm: EvaluationArm): AgentProvider => arm === "single-deepseek" ? "deepseek-api" : arm === "single-kimi" ? "kimi-api" : arm.includes("codex") ? "native-codex" : "pi-codex";
function requestPhase(messages: readonly ModelMessage[] = []): RequestRecord["phase"] {
  const stage = messages.find(item => item.role === "system" && /^TEAM_(PLAN|MEMBER|REVIEW|FOLLOWUP)：/.test(item.content))?.content;
  return stage?.startsWith("TEAM_PLAN：") ? "planning" : stage?.startsWith("TEAM_MEMBER：") ? "member" : stage?.startsWith("TEAM_REVIEW：") ? "review" : stage?.startsWith("TEAM_FOLLOWUP：") ? "followup" : "answer";
}
function actualMemberReasoning(rows: EvaluationRow[]) {
  const members = rows.flatMap(row => row.turns.flatMap(turn => turn.team?.members ?? []));
  return Object.fromEntries([...new Set(members.map(member => member.binding.provider))].map(provider => {
    const efforts = [...new Set(members.filter(member => member.binding.provider === provider).map(member => member.binding.reasoning))];
    return [provider, efforts.length === 1 ? efforts[0] : efforts];
  }));
}
function metered(client: AgentBackend, provider: AgentProvider, records: RequestRecord[], totalOutputLimit?: number): AgentBackend {
  const cap = Math.min(4096, capabilitiesFor(client).maxOutputTokens);
  if (isAgentExecutor(client)) return { kind: "agent-executor", identity: client.identity, capabilities: client.capabilities, contextBudget: client.contextBudget, prepare: client.prepare.bind(client), async execute(request, signal, onText) {
    signal.throwIfAborted(); if (records.length >= 12) throw new Error("team_budget_exhausted");
    const remaining = totalOutputLimit === undefined ? cap : totalOutputLimit - records.reduce((sum, item) => sum + (item.usage?.outputTokens ?? item.maxOutputTokens ?? cap), 0);
    const target = Math.min(cap, remaining); if (target < 128) throw new Error("team_budget_exhausted");
    const record: RequestRecord = { provider, model: client.identity.model, phase: requestPhase(request.messages), durationMs: 0, maxOutputTokens: target, requestedReasoning: request.reasoning, completed: false, transport: "native-task", outputLimit: "observed" };
    const started = Date.now(); records.push(record);
    try {
      const result = await client.execute({ ...request, maxOutputChars: Math.min(request.maxOutputChars, target * 2) }, signal, text => { record.firstOutputMs ??= Date.now() - started; onText?.(text); });
      record.completed = true; record.usage = result.usage;
      const schema = record.phase === "review" ? teamReviewDecisionSchema : ["member", "followup"].includes(record.phase) ? teamReportSchema : undefined;
      if (schema) record.reportIssue = teamJsonRepairReason(schema, result.text);
      return result;
    } catch (error) { record.failureCode = teamFailure(error, signal); throw error; }
    finally { record.durationMs = Date.now() - started; }
  } };
  const modelClient = client;
  async function* request(prompt: string, signal: AbortSignal, options?: ModelRequestOptions, results?: readonly ToolResultMessage[]): AsyncIterable<ModelEvent> {
    signal.throwIfAborted(); if (records.length >= 12) throw new Error("team_budget_exhausted");
    const remaining = totalOutputLimit === undefined ? Infinity : totalOutputLimit - records.reduce((sum, record) => sum + (record.usage?.outputTokens ?? record.maxOutputTokens ?? cap), 0);
    const effective = { ...options, maxOutputTokens: Math.min(cap, options?.maxOutputTokens ?? cap, remaining) };
    if (effective.maxOutputTokens < 128) throw new Error("team_budget_exhausted");
    const record: RequestRecord = { provider, model: client.identity?.model, phase: requestPhase(options?.messages), durationMs: 0, maxOutputTokens: effective.maxOutputTokens, requestedReasoning: options?.reasoning, completed: false };
    records.push(record); const started = Date.now(); let reportText = "";
    const reportSchema = record.phase === "review" ? teamReviewDecisionSchema : ["member", "followup"].includes(record.phase) ? teamReportSchema : undefined;
    try {
      const events = results ? (modelClient as ContinuableModelClient).continue(prompt, results, signal, effective) : modelClient.stream(prompt, signal, effective);
      for await (const event of events) { if (reportSchema && event.type === "text_delta") reportText = (reportText + (event.text ?? "")).slice(0, 8001); if (event.type === "usage" && event.usage) record.usage = event.usage; if (event.type === "timing") record.timing = event.timing; if (event.type === "done") record.completed = true; yield event; }
    } catch (error) { record.failureCode = teamFailure(error, signal); throw error; }
    finally { record.durationMs = Date.now() - started; if (record.completed && reportSchema) record.reportIssue = teamJsonRepairReason(reportSchema, reportText); }
  }
  return { identity: client.identity, ...(client.prepare ? { prepare: client.prepare.bind(client) } : {}), capabilities: { ...capabilitiesFor(client), maxOutputTokens: cap }, contextBudget: { windowTokens: client.contextBudget?.windowTokens ?? capabilitiesFor(client).contextWindowTokens, reserveOutputTokens: Math.min(cap, client.contextBudget?.reserveOutputTokens ?? cap) }, stream: request,
    ...(typeof (client as Partial<ContinuableModelClient>).continue === "function" ? { continue: (prompt: string, results: readonly ToolResultMessage[], signal: AbortSignal, options?: ModelRequestOptions) => request(prompt, signal, options, results) } : {}) };
}
export function summarizeTeamEvaluation(rows: EvaluationRow[]) {
  return evaluationArms.filter(arm => rows.some(row => row.arm === arm)).map(arm => {
    const group = rows.filter(row => row.arm === arm); const requests = group.flatMap(row => row.requests);
    const times = group.map(row => row.durationMs).sort((a, b) => a - b);
    return { arm, count: group.length, completed: group.filter(row => row.completed).length, correct: group.filter(row => row.grade.correct).length,
      fullySuccessful: group.filter(row => row.completed && row.grade.correct && row.grade.explanationPresent).length,
      meanFieldScore: group.length ? group.reduce((sum, row) => sum + row.grade.score, 0) / group.length : 0,
      medianMs: times.length ? (times[Math.floor((times.length - 1) / 2)]! + times[Math.floor(times.length / 2)]!) / 2 : 0, p95Ms: times.length ? times[Math.ceil(times.length * 0.95) - 1]! : 0,
      modelRequests: requests.filter(row => row.transport !== "native-task").length, nativeTasks: requests.filter(row => row.transport === "native-task").length, inputTokens: requests.reduce((sum, row) => sum + (row.usage?.inputTokens ?? 0), 0), outputTokens: requests.reduce((sum, row) => sum + (row.usage?.outputTokens ?? 0), 0),
      cacheReadTokens: requests.length && requests.every(row => row.usage?.cacheReadTokens !== undefined) ? requests.reduce((sum, row) => sum + row.usage!.cacheReadTokens!, 0) : null,
      unknownUsageRequests: requests.filter(row => !row.usage).length,
    };
  });
}
function comparisons(rows: EvaluationRow[], baseline: EvaluationArm) {
  return evaluationArms.filter(arm => arm !== baseline && rows.some(row => row.arm === arm)).map(arm => {
    let wins = 0; let ties = 0; let losses = 0;
    for (const row of rows.filter(row => row.arm === arm)) {
      const base = rows.find(item => item.arm === baseline && item.caseId === row.caseId && item.repeat === row.repeat);
      if (!base) continue;
      const delta = (row.completed ? row.grade.score : 0) - (base.completed ? base.grade.score : 0);
      if (delta > 0) wins++; else if (delta < 0) losses++; else ties++;
    }
    return { arm, against: baseline, wins, ties, losses, metric: "field_score_with_incomplete_zero" };
  });
}
/** Runs only the fixed synthetic suite, with isolated conversations and no workspace tools. */
export async function evaluateTeams(options: { root: string; suite: "pilot" | "holdout" | "regression" | "quality"; leadProvider?: "pi-codex" | "native-codex"; resolve: (provider: AgentProvider) => AgentBackend; signal: AbortSignal; onProgress?: (progress: EvaluationProgress) => void }) {
  const startedAt = new Date().toISOString(); const cases = options.suite === "pilot" ? teamDevelopmentCases : options.suite === "quality" ? teamQualityCases : options.suite === "regression" ? teamHoldoutCases.filter(item => ["H02", "H04"].includes(item.id)) : teamHoldoutCases;
  const repeats = options.suite === "holdout" ? 2 : 1;
  const qualityProtocol = ["quality", "regression"].includes(options.suite);
  const leadProvider = options.leadProvider ?? "pi-codex";
  const baseline: EvaluationArm = leadProvider === "native-codex" ? "single-codex" : "single-pi";
  const candidateArms = evaluationArms.filter(arm => leadProvider === "native-codex" ? !["single-pi", "self-review-pi"].includes(arm) : !["single-codex", "self-review-codex"].includes(arm));
  const arms = qualityProtocol ? candidateArms.filter(arm => !["single-deepseek", "single-kimi"].includes(arm)) : candidateArms;
  const selfReviewRounds = qualityProtocol ? 5 : 3;
  const clients = new Map<AgentProvider, AgentBackend>(); const bindings: ModelBinding[] = []; const unavailable = new Map<AgentProvider, string>();
  for (const provider of [leadProvider, "deepseek-api", "kimi-api"] as const) {
    try { const bound = await bindAgentModel(provider, options.resolve(provider), "balanced", options.signal); clients.set(provider, bound.client); bindings.push(bound.binding); }
    catch (error) { unavailable.set(provider, publicError(error)); }
  }
  const rows: EvaluationRow[] = [];
  const report = () => ({ version: 6, memberResourcePolicyVersion: 1, leadProvider, teamProtocol: 3, suite: options.suite, startedAt, finishedAt: new Date().toISOString(), planned: cases.length * repeats * arms.length,
    datasetHash: createHash("sha256").update(JSON.stringify(cases)).digest("hex"), bindings, unavailable: Object.fromEntries(unavailable), reasoning: "balanced", memberReasoning: actualMemberReasoning(rows), rows, summary: summarizeTeamEvaluation(rows), comparisons: comparisons(rows, baseline),
    limits: { maxModelRequestsPerArm: 12, rootDeadlineMs: 240_000, memberDeadlineMs: 180_000, maxOutputPerRequest: 4096, teamMaxOutputTokens: 16_384, totalOutputTokensPerArm: qualityProtocol ? 16_384 : null, selfReviewRounds },
    limitations: ["固定合成工程样本，不是独立人类盲评或真实教学效果试验", "各组实际调用与计算量不同；预算上限不等于严格等算力", "解释存在性不等于解释正确或教学有效", "成本只报告用量，未知用量和订阅账单不能记为零", "官方 Agent 的 token 预算是返回后核算，硬限制仅覆盖任务数、时限和可见回答长度", "官方 CLI 当前按完整消息交付，firstOutputMs 不能称为流式首 token 时间"],
  });
  const run = async (item: TeamEvaluationCase, repeat: number, arm: EvaluationArm): Promise<EvaluationRow> => {
    const started = Date.now(); const requests: RequestRecord[] = []; const turns: ChatMessage[] = [];
    const store = new AgentSessionStore(path.join(options.root, "sessions"));
    const service = new AgentService(store, provider => { const client = clients.get(provider); if (!client) throw new Error("provider_not_found"); return metered(client, provider, requests, qualityProtocol ? 16_384 : undefined); });
    const session = await service.create(); let text = ""; let error: string | undefined; let completed = false;
    const signal = AbortSignal.any([options.signal, AbortSignal.timeout(240_000)]);
    const collaboration = arm === "same-team" ? teamConfigurationSchema.parse({ mode: "same-model-team" }) : arm === "mixed-team" ? teamConfigurationSchema.parse({ mode: "mixed-model-team", members: [{ role: "reasoning-checker", provider: "deepseek-api" }, { role: "material-checker", provider: "kimi-api" }] }) : undefined;
    try {
      for (let round = 0; round < (["self-review-pi", "self-review-codex"].includes(arm) ? selfReviewRounds : 1); round++) {
        signal.throwIfAborted();
        try { await service.invoke({ sessionId: session.id, provider: ["same-team", "mixed-team"].includes(arm) ? leadProvider : providerFor(arm), style: "adaptive", reasoning: "balanced", mode: "chat", purpose: "answer", text: round ? "请独立重新检查这个问题与上次答案：查找计算错误、遗漏条件和解释不清的地方。以原问题要求的完整 JSON 重新给出最终答案，不要只列修改。" : item.question, collaboration }, { signal }); }
        finally { const message = (await store.load(session.id)).messages.at(-1); if (message?.role === "assistant") { turns.push(message); text = message.text; } await service.pauseMaintenance(); }
        completed = Boolean(turns.at(-1)?.status === "completed" && (!collaboration || turns.at(-1)?.team?.members.length === 2 && turns.at(-1)?.team?.members.every(member => member.status === "completed")));
        if (!completed) { error = turns.at(-1)?.error ?? "本组未完成全部回答或核查。"; break; }
      }
    } catch (problem) { completed = false; error = publicError(problem); }
    finally { service.stop(); await service.idle(); await service.pauseMaintenance(); }
    return { caseId: item.id, repeat, arm, completed, error, durationMs: Date.now() - started, firstTokenMs: requests[0]?.transport === "native-task" ? null : turns[0]?.firstTokenMs ?? null, firstOutputMs: turns[0]?.firstTokenMs ?? null, text, turns, requests, grade: scoreTeamAnswer(item, text) };
  };
  for (let repeat = 0; repeat < repeats; repeat++) for (const [index, item] of cases.entries()) {
    const offset = (index + repeat * 3) % arms.length;
    for (const arm of [...arms.slice(offset), ...arms.slice(0, offset)]) {
      options.onProgress?.({ completed: rows.length, total: cases.length * repeats * arms.length, caseId: item.id, arm, startedAt });
      rows.push(await run(item, repeat + 1, arm)); await atomicJson(path.join(options.root, "report.json"), report(), 32_000_000);
    }
  }
  return report();
}
