import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { abortable } from "./abortable.js";
import { isContinuableModelClient, type ModelClient, type ModelEvent, type ModelRequestOptions } from "./model.js";
import { capabilitiesFor } from "./model-capabilities.js";
import { apiProbeModeSchema, type ApiConnectionResult, type ProviderCapabilityEvidence } from "./provider-capability-contracts.js";
export type { ApiConnectionResult } from "./provider-capability-contracts.js";
const modelName = (value: unknown): string | null => typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(value) ? value : null;
/** Explicit fixed probes; synthetic tool is local data only, never an application/tool-harness action. */
export async function checkApiConnection(client: ModelClient, selected: { mode?: "text" | "tools" } = {}): Promise<ApiConnectionResult> {
  const mode = apiProbeModeSchema.parse(selected.mode ?? "text"), policy = structuredClone(capabilitiesFor(client));
  if (mode === "tools" && !isContinuableModelClient(client)) throw new Error("provider_tools_unsupported");
  const signal = AbortSignal.timeout(60_000), started = Date.now();
  let firstBodyMs: number | undefined, model: string | null = null, characters = 0, requests = 0;
  const options: ModelRequestOptions = { reasoning: "quick", maxOutputTokens: Math.min(2048, policy.maxOutputTokens), ...(mode === "tools" ? { tools: [{ name: "zhixing_connection_probe", description: "返回合成连接测试值，没有文件、网络或其他副作用。", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] } : {}) };
  const prompt = mode === "text" ? "这是连接测试。请仅回复“连接正常”。" : "这是合成工具协议连接测试。请先调用 zhixing_connection_probe（空参数），收到工具返回后仅回复其中 nonce 的原文。不要调用其他工具。";
  async function turn(stream: AsyncIterable<ModelEvent>) {
    requests++; const iterator = stream[Symbol.asyncIterator](), events: ModelEvent[] = []; let done = false, text = "", tools = 0;
    try {
      for (;;) {
        const next = await abortable(() => iterator.next(), signal); if (next.done) break;
        const event = next.value;
        if (events.length >= 4096) throw new Error("provider_output_limit");
        if (event.type === "tool_call") { if (mode !== "tools" || ++tools > 1 || event.tool !== "zhixing_connection_probe" || !z.object({}).strict().safeParse(event.input).success) throw new Error("provider_protocol_error"); }
        if (event.type === "text_delta") { const part = event.text ?? ""; characters += part.length; if (characters > 4000) throw new Error("provider_output_limit"); text += part; if (part.trim()) firstBodyMs ??= Date.now() - started; }
        const reported = modelName(event.reportedModel);
        if (model && reported && model !== reported) throw new Error("provider_model_mismatch");
        model = reported ?? model;
        events.push(event); if (event.type === "done") { done = true; break; }
      }
      if (!done) throw new Error("provider_incomplete"); return { events, text };
    } finally { void iterator.return?.().catch(() => undefined); }
  }
  try {
    const first = await turn(client.stream(prompt, signal, options)); let text = first.text;
    let tools: ProviderCapabilityEvidence["observed"]["tools"] = mode === "tools" ? "inconclusive" : "not_tested";
    const call = first.events.find(event => event.type === "tool_call");
    if (call && isContinuableModelClient(client)) {
      const nonce = randomUUID(), toolResults = [{ tool: "zhixing_connection_probe", callId: call.callId, result: { nonce } }];
      const next = await turn(client.continue(prompt, toolResults, signal, { ...options, history: [{ events: first.events, toolResults }] }));
      if (next.events.some(event => event.type === "tool_call")) throw new Error("provider_protocol_error");
      text = next.text; if (text.includes(nonce)) tools = "roundtrip_confirmed";
    }
    if (!text.trim() || firstBodyMs === undefined) throw new Error("provider_incomplete");
    signal.throwIfAborted();
    return { ...(model ? { model } : {}), firstTokenMs: firstBodyMs, firstBodyMs, durationMs: Date.now() - started,
      capabilityEvidence: { version: 1, checkedAt: new Date().toISOString(), mode, requestedModel: modelName(client.identity?.model), reportedModel: model, modelSource: model ? "provider_reported" : "unreported", policy,
        observed: { text: "confirmed", tools, images: "not_tested", contextLimit: "not_tested", outputLimit: "requested_not_verified", reasoning: "requested_not_verified" }, requests, requestUnit: "logical_model_turn" },
    };
  } catch (error) { if (signal.aborted) throw new Error("provider_timeout"); throw error; }
}
