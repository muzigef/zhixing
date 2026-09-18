import { providerBenchmarkSelectionSchema } from "./provider-performance-contracts.js";
export { providerBenchmarkSelectionSchema } from "./provider-performance-contracts.js";
import { isAgentExecutor, type AgentBackend } from "./agent-executor.js";
import type { ModelUsage } from "./model.js";
import { sourceHash } from "./source-version.js";
import { abortable } from "./abortable.js";
import { teamFailure } from "./team-quality.js";
const prompt = "这是固定性能测试，不需要工具或外部资料。计算2+2，只回复一个数字。";
export interface PerformanceSample { cycle: number; phase: "fresh_client" | "reused_client"; provider: string; model: string; transport: "native-task" | "model-stream"; timingUnit: "completed_message" | "first_body_chunk"; requestAttempted: boolean; completed: boolean; status: "not_attempted" | "running" | "completed" | "failed" | "cancelled"; failure?: string; prepareMs: number | null; firstEventMs: number | null; firstBodyMs: number | null; firstTokenMs: number | null; totalMs: number | null; usageKnown: boolean; usage?: ModelUsage; outputCharacters: number; outputHash?: string; }
const quantiles = (values: number[]) => { const sorted = values.sort((a, b) => a - b); return { samples: sorted.length, p50: sorted.length ? sorted[Math.ceil(sorted.length * .5) - 1]! : null, p95: sorted.length ? sorted[Math.ceil(sorted.length * .95) - 1]! : null }; };
function summarize(rows: PerformanceSample[]) {
  const groups = [...new Set(rows.map(row => JSON.stringify([row.phase, row.provider, row.model, row.transport])))];
  return groups.map(key => {
    const group = rows.filter(row => JSON.stringify([row.phase, row.provider, row.model, row.transport]) === key), completed = group.filter(row => row.completed), attempted = group.filter(row => row.requestAttempted).length;
    return { phase: group[0]!.phase, provider: group[0]!.provider, model: group[0]!.model, transport: group[0]!.transport, planned: group.length, attempted, completed: completed.length, failures: group.filter(row => row.status === "failed").length, cancelled: group.filter(row => row.status === "cancelled").length, notAttempted: group.filter(row => !row.requestAttempted).length, failureRate: attempted ? group.filter(row => row.requestAttempted && !row.completed).length / attempted : null,
      firstBody: quantiles(completed.flatMap(row => row.firstBodyMs === null ? [] : [row.firstBodyMs])), total: quantiles(completed.flatMap(row => row.totalMs === null ? [] : [row.totalMs])), preparation: quantiles(completed.flatMap(row => row.prepareMs === null ? [] : [row.prepareMs])), unknownUsage: group.filter(row => row.requestAttempted && !row.usageKnown).length };
  });
}
export async function benchmarkProviderPerformance(options: { cycles: number; create: () => AgentBackend; signal: AbortSignal; now?: () => number; checkpoint?: (report: ReturnType<typeof reportFor>) => Promise<void> }) {
  const { cycles } = providerBenchmarkSelectionSchema.parse({ cycles: options.cycles }); const now = options.now ?? (() => performance.now());
  const startedAt = new Date().toISOString(), rows: PerformanceSample[] = [];
  const report = () => reportFor(rows, cycles, startedAt);
  await options.checkpoint?.(report());
  for (let cycle = 1; cycle <= cycles; cycle++) {
    let client: AgentBackend | undefined;
    for (const phase of ["fresh_client", "reused_client"] as const) {
      const row: PerformanceSample = { cycle, phase, provider: "unknown", model: "unknown", transport: "model-stream", timingUnit: "first_body_chunk", requestAttempted: false, completed: false, status: "not_attempted", prepareMs: null, firstEventMs: null, firstBodyMs: null, firstTokenMs: null, totalMs: null, usageKnown: false, outputCharacters: 0 }; rows.push(row);
      await options.checkpoint?.(report());
      if (options.signal.aborted) { row.status = "cancelled"; await options.checkpoint?.(report()); continue; }
      const start = now(), signal = AbortSignal.any([options.signal, AbortSignal.timeout(60_000)]); let text = "", persistenceFailed = false;
      try {
        if (phase === "fresh_client") client = options.create();
        if (!client) throw new Error("provider_unavailable");
        row.provider = client.identity?.provider ?? "unknown"; row.model = client.identity?.model ?? "unknown";
        const native = isAgentExecutor(client);
        row.transport = native ? "native-task" : "model-stream"; row.timingUnit = native ? "completed_message" : "first_body_chunk";
        await abortable(async () => { await client!.prepare?.(signal); }, signal); row.prepareMs = now() - start;
        row.status = "running";
        try { await options.checkpoint?.(report()); } catch (error) { persistenceFailed = true; throw error; }
        // Checkpoint failure above prevents dispatch; it is not a provider failure.
        signal.throwIfAborted(); row.requestAttempted = true;
        const body = (value: string) => { if (value.trim() && row.firstBodyMs === null) row.firstBodyMs = now() - start; text += value; if (text.length > 1000) throw new Error("provider_output_limit"); };
        if (isAgentExecutor(client)) {
          const executor = client;
          const result = await abortable(() => executor.execute({ messages: [{ role: "user", content: prompt }], reasoning: "quick", maxOutputChars: 1000 }, signal, body), signal);
          if (result.status !== "completed" || !result.text.trim() || text && result.text !== text) throw new Error("provider_protocol_error");
          if (!text) body(result.text); row.usage = result.usage;
        } else {
          const iterator = client.stream(prompt, signal, { messages: [{ role: "user", content: prompt }], reasoning: "quick", maxOutputTokens: 2048, tools: [] })[Symbol.asyncIterator](); let done = false;
          try {
            for (;;) {
              const next = await abortable(() => iterator.next(), signal); if (next.done) break;
              row.firstEventMs ??= now() - start;
              if (next.value.type === "tool_call") throw new Error("provider_protocol_error");
              if (next.value.type === "text_delta") body(next.value.text ?? "");
              if (next.value.type === "usage") row.usage = next.value.usage;
              if (next.value.type === "done") { done = true; break; }
            }
            if (!done) throw new Error("provider_incomplete");
          } finally { void iterator.return?.().catch(() => undefined); }
        }
        signal.throwIfAborted(); if (!text.trim()) throw new Error("provider_incomplete");
        row.completed = true; row.status = "completed";
      } catch (error) { if (persistenceFailed) throw error; row.status = options.signal.aborted ? "cancelled" : "failed"; row.failure = signal.aborted && !options.signal.aborted ? "timeout" : teamFailure(error, signal); }
      row.totalMs = now() - start; row.usageKnown = Boolean(row.usage); row.outputCharacters = text.length; if (text) row.outputHash = sourceHash(text);
      // Chunk delivery is not an instrumented tokenizer clock, so this field stays null for both transports.
      await options.checkpoint?.(report());
    }
  }
  return report();
}
function reportFor(rows: PerformanceSample[], cycles: number, startedAt: string) {
  return { version: 1, startedAt, planned: cycles * 2, prompt, promptHash: sourceHash(prompt), reasoning: "quick", limits: { cycles, deadlinePerCallMs: 60_000, visibleCharacters: 1000, apiOutputTokens: 2048, nativeOutputTokenLimit: "observed_not_hard" }, rows, summary: summarize(rows), interpretation: "fresh_client为新建应用客户端，reused_client复用同一客户端；每次无历史、固定相同提示。不证明机器冷启动、持久原生进程或远端缓存冷热。首事件可能仅为进度；首正文是首个非空白输出块，原生CLI当前为完整消息。只用完成请求算耗时分位数，失败/取消/未尝试单列，小样本不代表服务水平。prepare之外执行器可能再次验证运行时，其成本仍计入整次耗时。" };
}
