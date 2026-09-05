import type { ChatMessage } from "./contracts.js";
export interface ProviderPerformance { provider: "pi-codex" | "deepseek-api" | "demo"; completed: number; failed: number; interrupted: number; firstTokenP50?: number; firstTokenP95?: number; durationP50?: number; contextP50?: number; modelP50?: number; compactionP50?: number; }
function percentile(values: (number | undefined)[], fraction: number): number | undefined { const sorted = values.filter((value): value is number => value !== undefined && Number.isFinite(value)).sort((a, b) => a - b); return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : undefined; }
/** Numeric metadata only. Demo and real providers are never combined. */
export function summarizePerformance(messages: readonly ChatMessage[]): ProviderPerformance[] {
  return (["pi-codex", "deepseek-api", "demo"] as const).map((provider) => {
    const samples = messages.filter((message) => message.role === "assistant" && message.provider === provider && message.status !== "running");
    const completed = samples.filter((message) => message.status === "completed");
    return { provider, completed: completed.length, failed: samples.filter((message) => message.status === "failed").length, interrupted: samples.filter((message) => message.status === "interrupted").length, firstTokenP50: percentile(completed.map((message) => message.firstTokenMs), .5), firstTokenP95: percentile(completed.map((message) => message.firstTokenMs), .95), durationP50: percentile(completed.map((message) => message.durationMs), .5), contextP50: percentile(completed.map((message) => message.timings?.contextMs), .5), modelP50: percentile(completed.map((message) => message.timings?.modelMs), .5), compactionP50: percentile(completed.map((message) => message.timings?.compactionMs), .5) };
  });
}
