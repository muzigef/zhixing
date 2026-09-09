import { abortable } from "./abortable.js";
import type { ModelClient } from "./model.js";

export interface ApiConnectionResult { model?: string; firstTokenMs: number; durationMs: number; }
/** Explicit connectivity probe: no learning data, history, tool execution or persistence. */
export async function checkApiConnection(client: ModelClient): Promise<ApiConnectionResult> {
  const signal = AbortSignal.timeout(60_000);
  const started = Date.now(); let firstTokenMs: number | undefined; let model: string | undefined; let done = false;
  const iterator = client.stream("这是连接测试。请仅回复“连接正常”。", signal, { reasoning: "quick", maxOutputTokens: 2048 })[Symbol.asyncIterator]();
  try {
    for (;;) {
      const next = await abortable(() => iterator.next(), signal);
      if (next.done) break;
      const event = next.value;
      if (event.type === "tool_call") throw new Error("provider_protocol_error");
      if (event.type === "text_delta" && event.text?.trim()) firstTokenMs ??= Date.now() - started;
      if (event.type === "usage") model = event.usage?.model;
      if (event.type === "done") { done = true; break; }
    }
    if (!done || firstTokenMs === undefined) throw new Error("provider_incomplete");
    return { model, firstTokenMs, durationMs: Date.now() - started };
  } catch (error) {
    if (signal.aborted) throw new Error("provider_timeout");
    throw error;
  } finally { void iterator.return?.().catch(() => undefined); }
}
