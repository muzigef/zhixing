import { capabilitiesFor } from "./model-capabilities.js";
import { estimateTokens } from "./context-window.js";
import { imageBudgetView } from "./image-input.js";
import type { ContinuableModelClient, ModelClient, ModelEvent, ModelRequestOptions, ToolResultMessage } from "./model.js";
import type { TeamConfiguration, TeamSnapshot } from "./team-contracts.js";
import { isAgentExecutor, type AgentBackend, type AgentExecutor } from "./agent-executor.js";
type Purpose = "lead" | "member" | "planning" | "review" | "followup";

/** Counts reservations durably, including requests whose billing outcome is unknown. */
export class TeamBudget {
  private changes: Promise<void> = Promise.resolve();
  private storageError?: unknown;
  private connections = new Map<string, Set<symbol>>();
  private changed = new Set<() => void>();
  constructor(private config: TeamConfiguration, private state: TeamSnapshot, private save: () => Promise<void>) {}
  private async mutate(action: () => void): Promise<void> {
    const work = this.changes.then(async () => {
      if (this.storageError) throw this.storageError;
      action(); try { await this.save(); } catch (error) { this.storageError = error; throw error; }
    });
    // A denied reservation is recoverable; a storage failure forbids new requests.
    this.changes = work.catch(() => {}); await work;
  }
  private async acquire(client: AgentBackend, signal: AbortSignal): Promise<() => void> {
    const key = client.identity?.connection ?? "local";
    const limit = client.identity?.provider === "pi-codex" ? 1 : this.config.maxConcurrency;
    const slots = this.connections.get(key) ?? new Set<symbol>(); this.connections.set(key, slots);
    while (slots.size >= limit) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { this.changed.delete(wake); signal.removeEventListener("abort", abort); };
        const wake = () => { cleanup(); resolve(); }; const abort = () => { cleanup(); reject(signal.reason); };
        this.changed.add(wake); signal.addEventListener("abort", abort, { once: true }); if (signal.aborted) abort();
      });
    }
    signal.throwIfAborted(); const token = Symbol(); slots.add(token);
    return () => { slots.delete(token); for (const wake of [...this.changed]) wake(); };
  }
  wrap(client: AgentExecutor, purpose: Purpose, requestedCap?: number): AgentExecutor;
  wrap(client: ModelClient, purpose: Purpose, requestedCap?: number): ModelClient;
  wrap(client: AgentBackend, purpose: Purpose, requestedCap?: number): AgentBackend;
  wrap(client: AgentBackend, purpose: Purpose, requestedCap?: number): AgentBackend {
    const capabilities = capabilitiesFor(client);
    const cap = Math.min(capabilities.maxOutputTokens, requestedCap ?? (purpose === "planning" ? 1024 : purpose === "review" ? 2048 : 4096));
    if (isAgentExecutor(client)) return { kind: "agent-executor", identity: client.identity, capabilities, contextBudget: client.contextBudget, prepare: client.prepare.bind(client), execute: (request, signal, onText) => this.nativeRequest(client, purpose, cap, request, signal, onText) };
    const stream = (prompt: string, signal: AbortSignal, options?: ModelRequestOptions) => this.request(client, purpose, cap, prompt, signal, options);
    return { identity: client.identity, ...(client.prepare ? { prepare: client.prepare.bind(client) } : {}), capabilities: { ...capabilities, maxOutputTokens: cap },
      contextBudget: { windowTokens: client.contextBudget?.windowTokens ?? capabilities.contextWindowTokens, reserveOutputTokens: Math.min(cap, client.contextBudget?.reserveOutputTokens ?? cap) }, stream,
      ...(typeof (client as Partial<ContinuableModelClient>).continue === "function" ? { continue: (prompt: string, results: readonly ToolResultMessage[], signal: AbortSignal, options?: ModelRequestOptions) => this.request(client, purpose, cap, prompt, signal, options, results) } : {}) };
  }
  private async nativeRequest(client: AgentExecutor, purpose: Purpose, cap: number, request: Parameters<AgentExecutor["execute"]>[0], signal: AbortSignal, onText?: (text: string) => void) {
    const release = await this.acquire(client, signal); let reserved = 0;
    try {
      const input = estimateTokens(JSON.stringify(request.messages));
      await this.mutate(() => {
        signal.throwIfAborted();
        const reserveLead = purpose === "lead" ? 0 : Math.min(4096, Math.floor(this.config.maxOutputTokens / 2));
        const reserveReview = this.state.protocol && ["member", "planning"].includes(purpose) && this.state.review?.status === "pending" ? Math.min(2048, Math.floor(this.config.maxOutputTokens / 8)) : 0;
        reserved = Math.min(cap, this.config.maxOutputTokens - this.state.reservedOutputTokens - reserveLead - reserveReview);
        if (reserved < 128 || this.state.modelTurns + (this.state.nativeTasks ?? 0) >= this.config.maxModelTurns - (purpose === "lead" ? 0 : 2) || Math.max(this.state.estimatedInputTokens, this.state.inputTokens) + input > this.config.maxInputTokens) throw new Error("team_budget_exhausted");
        this.state.nativeTasks = (this.state.nativeTasks ?? 0) + 1;
        this.state.nativeTokenLimit = "observed"; this.state.reservedOutputTokens += reserved;
        this.state.estimatedInputTokens += input; this.state.unknownUsageRequests++;
      });
      signal.throwIfAborted();
      // CLI has no hard token cap: bound visible characters, task count and deadline instead.
      // Keep its output target reserved until authoritative usage arrives, including on failure.
      const maxOutputChars = Math.min(request.maxOutputChars, reserved * 2);
      const result = await client.execute({ ...request, maxOutputChars }, signal, onText);
      if (result.usage) {
        const usage = result.usage;
        if (![usage.inputTokens, usage.outputTokens].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("provider_usage_invalid");
        await this.mutate(() => { this.state.unknownUsageRequests--; this.state.inputTokens += usage.inputTokens; this.state.outputTokens += usage.outputTokens; this.state.reservedOutputTokens += usage.outputTokens - reserved; });
      }
      signal.throwIfAborted();
      if (result.text.length > maxOutputChars) throw new Error("provider_output_limit");
      return result;
    } finally { release(); }
  }
  private async *request(client: ModelClient, purpose: "lead" | "member" | "planning" | "review" | "followup", cap: number, prompt: string, signal: AbortSignal, options?: ModelRequestOptions, results?: readonly ToolResultMessage[]): AsyncIterable<ModelEvent> {
    const release = await this.acquire(client, signal);
    let reserved = 0; let reported = false;
    try {
      const view = imageBudgetView({ messages: options?.messages ?? [{ role: "user", content: prompt }], history: options?.history, tools: options?.tools, results });
      const input = estimateTokens(view.text) + view.imageTokens;
      await this.mutate(() => {
        signal.throwIfAborted();
        const reserveLead = purpose === "lead" ? 0 : Math.min(4096, Math.floor(this.config.maxOutputTokens / 2));
        const reserveReview = this.state.protocol && ["member", "planning"].includes(purpose) && this.state.review?.status === "pending" ? Math.min(2048, Math.floor(this.config.maxOutputTokens / 8)) : 0;
        reserved = Math.min(cap, options?.maxOutputTokens ?? cap, this.config.maxOutputTokens - this.state.reservedOutputTokens - reserveLead - reserveReview);
        if (reserved < 128 || this.state.modelTurns + (this.state.nativeTasks ?? 0) >= this.config.maxModelTurns - (purpose === "lead" ? 0 : 2) || Math.max(this.state.estimatedInputTokens, this.state.inputTokens) + input > this.config.maxInputTokens) throw new Error("team_budget_exhausted");
        this.state.modelTurns++; this.state.reservedOutputTokens += reserved; this.state.estimatedInputTokens += input; this.state.unknownUsageRequests++;
      });
      signal.throwIfAborted();
      const request = { ...options, maxOutputTokens: reserved };
      const events = results ? (client as ContinuableModelClient).continue(prompt, results, signal, request) : client.stream(prompt, signal, request);
      for await (const event of events) {
        signal.throwIfAborted();
        if (event.type === "tool_call") await this.mutate(() => { if (this.state.toolCalls >= this.config.maxToolCalls) throw new Error("team_tool_budget_exhausted"); this.state.toolCalls++; });
        if (event.type === "usage" && event.usage && !reported) {
          const usage = event.usage;
          if (![usage.inputTokens, usage.outputTokens].every(value => Number.isFinite(value) && value >= 0)) throw new Error("provider_usage_invalid");
          await this.mutate(() => {
            reported = true; this.state.unknownUsageRequests--; this.state.inputTokens += usage.inputTokens; this.state.outputTokens += usage.outputTokens;
            this.state.reservedOutputTokens += Math.ceil(usage.outputTokens) - reserved;
          });
        }
        yield event;
      }
    } finally { release(); }
  }
}
