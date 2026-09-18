import { z } from "zod/v4";
import type { ModelCapabilities } from "./model-capabilities.js";
export const apiProbeModeSchema = z.enum(["text", "tools"]);
export interface ProviderCapabilityEvidence {
  version: 1; checkedAt: string; mode: z.infer<typeof apiProbeModeSchema>;
  requestedModel: string | null; reportedModel: string | null; modelSource: "provider_reported" | "unreported";
  policy: ModelCapabilities;
  observed: { text: "confirmed"; tools: "not_tested" | "roundtrip_confirmed" | "inconclusive"; images: "not_tested"; contextLimit: "not_tested"; outputLimit: "requested_not_verified"; reasoning: "requested_not_verified" };
  requests: number; requestUnit: "logical_model_turn";
}
export interface NativeRuntimeProbe { version: string | null; source: "process_reported"; isolationBasis: "allowlisted_version" | "required_flags" | "unavailable"; }
export function reportedModelName(value: unknown): string | undefined { return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value) ? value : undefined; }
export interface ApiConnectionResult { model?: string; /** Compatibility alias for the first nonblank body. */ firstTokenMs: number; firstBodyMs: number; durationMs: number; capabilityEvidence: ProviderCapabilityEvidence; }
export function connectionProbeLabel(result: ApiConnectionResult): string {
  const tools = result.capabilityEvidence.observed.tools;
  const observation = tools === "roundtrip_confirmed" ? "合成工具往返已验证" : tools === "inconclusive" ? "工具往返未确认" : "文本回复已验证，工具未测试";
  return `连接正常 · 首正文 ${(result.firstBodyMs / 1000).toFixed(2)} 秒 · 总耗时 ${(result.durationMs / 1000).toFixed(2)} 秒 · ${observation}；图片和容量未验证。`;
}
