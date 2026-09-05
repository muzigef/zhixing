export type ModelRole = "tutor" | "reviewer" | "lab";

export interface ModelEvent { readonly type: "text_delta" | "tool_call" | "tool_result" | "done"; readonly text?: string; readonly tool?: string; readonly input?: unknown; readonly result?: unknown; readonly callId?: string; }
/** Public tool schema advertised to providers; execution remains in ToolHarness. */
export interface ModelToolDefinition { readonly name: string; readonly description: string; readonly inputSchema: Readonly<Record<string, unknown>>; }
/** Complete prior turns are owned by the invocation, never shared by provider instances. */
export interface ModelTurn { readonly events: readonly ModelEvent[]; readonly toolResults: readonly ToolResultMessage[]; }
/** Per-request context required for protocol-correct, isolated tool continuation. */
export interface ModelRequestOptions { readonly tools?: readonly ModelToolDefinition[]; readonly history?: readonly ModelTurn[]; }
export interface ModelClient { stream(prompt: string, signal: AbortSignal, options?: ModelRequestOptions): AsyncIterable<ModelEvent>; }
export interface ToolResultMessage { readonly tool: string; readonly result: unknown; readonly callId?: string; }
/** Optional capability: a provider can continue an agent turn after controlled tool results. */
export interface ContinuableModelClient extends ModelClient {
  continue(prompt: string, toolResults: readonly ToolResultMessage[], signal: AbortSignal, options?: ModelRequestOptions): AsyncIterable<ModelEvent>;
}
export function isContinuableModelClient(client: ModelClient): client is ContinuableModelClient {
  return typeof (client as Partial<ContinuableModelClient>).continue === "function";
}

/** Offline deterministic provider used by all mandatory tests. */
export class MockModelClient implements ModelClient {
  async *stream(prompt: string, signal: AbortSignal): AsyncIterable<ModelEvent> {
    if (signal.aborted) throw new DOMException("cancelled", "AbortError");
    const citations = [...new Set(prompt.match(/\[[^\]\n]+#(?:page|anchor)=[^\]\n]+\]/g) ?? [])].slice(0, 3);
    yield { type: "text_delta", text: citations.length
      ? `Mock：当前为离线演示，仅验证资料引用流程，未生成真实模型答案。\n${citations.join("\n")}`
      : `Mock：${prompt.slice(0, 120)}` };
    yield { type: "done" };
  }
}

/** Routes model roles without leaking provider credential details into workflows. */
export class ModelRouter {
  constructor(private readonly clients: ReadonlyMap<ModelRole, ModelClient>) {}
  resolve(role: ModelRole): ModelClient { return this.clients.get(role) ?? new MockModelClient(); }
}
