import { z, type ZodType } from "zod";
import type { TopicId } from "./contracts.js";

export type ToolRisk = "read" | "write" | "destructive";
export interface ToolDefinition<I, O> {
  readonly name: string;
  readonly input: ZodType<I>;
  readonly risk: ToolRisk;
  readonly timeoutMs: number;
  readonly idempotent: boolean;
  readonly execute: (input: I, context: ToolExecutionContext) => Promise<O>;
}
export interface ToolExecutionContext {
  readonly topicId: TopicId;
  readonly signal: AbortSignal;
  /** The control plane supplies the maximum capability for this run. */
  readonly maxRisk?: ToolRisk;
}
export interface ToolResult { readonly tool: string; readonly ok: boolean; readonly output?: unknown; readonly errorCode?: string; readonly durationMs: number; }

/** Enforces schema, topic scope, deadline and bounded tool results at one boundary. */
export class ToolHarness {
  #tools = new Map<string, ToolDefinition<unknown, unknown>>();
  register<I, O>(tool: ToolDefinition<I, O>): void {
    if (this.#tools.has(tool.name)) throw new Error(`duplicate_tool: ${tool.name}`);
    this.#tools.set(tool.name, tool as ToolDefinition<unknown, unknown>);
  }
  async execute(name: string, rawInput: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    const tool = this.#tools.get(name); const started = Date.now();
    if (!tool) return { tool: name, ok: false, errorCode: "tool_not_allowed", durationMs: Date.now() - started };
    if (context.signal.aborted) return { tool: name, ok: false, errorCode: "tool_cancelled", durationMs: Date.now() - started };
    // Inspect the raw input: object schemas can strip a model-supplied topicId.
    if (typeof rawInput === "object" && rawInput !== null && "topicId" in rawInput && rawInput.topicId !== context.topicId) return { tool: name, ok: false, errorCode: "cross_topic_denied", durationMs: Date.now() - started };
    if (riskRank(tool.risk) > riskRank(context.maxRisk ?? "read")) return { tool: name, ok: false, errorCode: "tool_policy_denied", durationMs: Date.now() - started };
    let timeout: AbortSignal | undefined;
    try {
      const input = tool.input.parse(rawInput);
      timeout = AbortSignal.timeout(tool.timeoutMs);
      const signal = AbortSignal.any([context.signal, timeout]);
      signal.throwIfAborted();
      const output = await withDeadline(tool.execute(input, { ...context, signal }), signal);
      signal.throwIfAborted();
      return { tool: name, ok: true, output: bound(output), durationMs: Date.now() - started };
    } catch (error) {
      const code = context.signal.aborted ? "tool_cancelled" : timeout?.aborted ? "tool_timeout" : error instanceof z.ZodError ? "tool_input_invalid" : "tool_failed";
      return { tool: name, ok: false, errorCode: code, durationMs: Date.now() - started };
    }
  }
}

function riskRank(risk: ToolRisk): number { return ({ read: 0, write: 1, destructive: 2 })[risk]; }

async function withDeadline<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason;
  return await new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason instanceof Error ? signal.reason : new DOMException("cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    void operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function bound(output: unknown): unknown {
  const serialized = JSON.stringify(output ?? null);
  if (serialized === undefined) throw new Error("tool_output_invalid");
  if (serialized.length <= 12_000) return output ?? null;
  return { truncated: true, preview: serialized.slice(0, 12_000) };
}
