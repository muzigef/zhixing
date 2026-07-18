export type ModelRole = "tutor" | "reviewer" | "lab";

export interface ModelEvent { readonly type: "text_delta" | "tool_call" | "done"; readonly text?: string; readonly tool?: string; readonly input?: unknown; }
export interface ModelClient { stream(prompt: string, signal: AbortSignal): AsyncIterable<ModelEvent>; }

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
