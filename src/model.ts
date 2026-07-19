export type ModelRole = "tutor" | "reviewer" | "lab";

export interface ModelEvent { readonly type: "text_delta" | "tool_call" | "tool_result" | "done"; readonly text?: string; readonly tool?: string; readonly input?: unknown; readonly result?: unknown; }
export interface ModelClient { stream(prompt: string, signal: AbortSignal): AsyncIterable<ModelEvent>; }
export interface ToolResultMessage { readonly tool: string; readonly result: unknown; }
/** Optional capability: a provider can continue an agent turn after controlled tool results. */
export interface ContinuableModelClient extends ModelClient {
  continue(prompt: string, toolResults: readonly ToolResultMessage[], signal: AbortSignal): AsyncIterable<ModelEvent>;
}
export function isContinuableModelClient(client: ModelClient): client is ContinuableModelClient {
  return typeof (client as Partial<ContinuableModelClient>).continue === "function";
}

/** Offline deterministic provider used by all mandatory tests. */
export class MockModelClient implements ModelClient {
  async *stream(prompt: string, signal: AbortSignal): AsyncIterable<ModelEvent> {
    if (signal.aborted) throw new DOMException("cancelled", "AbortError");
    yield { type: "text_delta", text: `Mock：${prompt.slice(0, 120)}` };
    yield { type: "done" };
  }
}

/** Routes model roles without leaking provider credential details into workflows. */
export class ModelRouter {
  constructor(private readonly clients: ReadonlyMap<ModelRole, ModelClient>) {}
  resolve(role: ModelRole): ModelClient { return this.clients.get(role) ?? new MockModelClient(); }
}
