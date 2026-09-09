import { z, type ZodType } from "zod/v4";
import type { TopicId } from "./contracts.js";
import type { ModelToolDefinition } from "./model.js";
import { boundToolOutput } from "./tool-results.js";
import type { ToolResultStore } from "./tool-result-store.js";

const actionableErrors = new Set(["task_plan_invalid", "task_plan_requirement_changed", "project_file_conflict", "project_tree_conflict", "project_tests_required", "project_selection_changed", "project_result_outdated", "project_limit", "project_busy", "project_git_unavailable", "mcp_configuration_changed", "mcp_input_invalid", "mcp_input_limit", "mcp_remote_error", "mcp_result_unsupported"]);

export type ToolRisk = "read" | "write" | "destructive";
/** An external effect may have happened. Keep the call executing for explicit recovery. */
export class ToolOutcomeUnknown extends Error { constructor() { super("tool_recovery_required"); } }
export interface ToolDefinition<I, O> {
  readonly name: string;
  readonly description?: string;
  /** MCP's remote JSON Schema is validated by its isolated worker. */
  readonly remoteInputSchema?: Readonly<Record<string, unknown>>;
  readonly input: ZodType<I>;
  readonly risk: ToolRisk;
  readonly timeoutMs: number;
  readonly idempotent: boolean;
  /** Tools sharing an external resource invalidate each other's observations after writes. */
  readonly resource?: string;
  /** Explicitly pure and independent; risk=read alone is insufficient. */
  readonly parallelSafe?: boolean;
  readonly validate?: (input: I, context: ToolExecutionContext) => Promise<void>;
  readonly review?: (input: I, context: ToolExecutionContext) => Promise<string>;
  readonly execute: (input: I, context: ToolExecutionContext) => Promise<O>;
}
export interface ToolExecutionContext {
  readonly topicId: TopicId;
  readonly callId?: string;
  readonly signal: AbortSignal;
  /** The control plane supplies the maximum capability for this run. */
  readonly maxRisk?: ToolRisk;
}
export interface ToolResult { readonly tool: string; readonly ok: boolean; readonly output?: unknown; readonly errorCode?: string; readonly issues?: readonly { path: string; code: string; expected?: string }[]; readonly durationMs: number; }

/** Public diagnostics contain schema locations and expected types, never raw input values. */
export function toolFailure(error: unknown): { ok: false; errorCode: string; issues?: ToolResult["issues"] } {
  if (error instanceof z.ZodError) return { ok: false, errorCode: "tool_input_invalid", issues: error.issues.slice(0, 8).map(issue => ({ path: issue.path.join(".").slice(0, 120), code: issue.code, ...("expected" in issue && typeof issue.expected === "string" ? { expected: issue.expected.slice(0, 80) } : {}) })) };
  return { ok: false, errorCode: error instanceof Error && actionableErrors.has(error.message) ? error.message : "tool_failed" };
}

/** Enforces schema, topic scope, deadline and bounded tool results at one boundary. */
export class ToolHarness {
  #tools = new Map<string, ToolDefinition<unknown, unknown>>();
  private results?: ToolResultStore;
  private policies: ((name: string) => boolean)[] = [];
  /** Monotonic capability restriction, including tools discovered later. */
  restrict(allowed: (name: string) => boolean): void { this.policies.push(allowed); }
  private allowed(name: string): boolean { return this.policies.every(policy => policy(name)); }
  useResults(store: ToolResultStore): void {
    this.results = store;
    this.register({ name: "read_tool_result", description: "按 resultId 分页读取本任务被截断的工具结果。content 是 JSON 原文片段，nextOffset 非空时继续，不能将片段当完整结果。", input: z.object({ resultId: z.string().regex(/^[a-f0-9]{64}$/), offset: z.number().int().min(0).max(256_000).default(0) }).strict(), risk: "read", idempotent: true, parallelSafe: true, timeoutMs: 1000, execute: async (input, context) => store.read(context.topicId, input.resultId, input.offset) });
  }
  definitions(): ModelToolDefinition[] {
    return [...this.#tools.values()].filter(tool => tool.description !== undefined && this.allowed(tool.name)).map(tool => {
      const inputSchema = tool.remoteInputSchema ?? z.toJSONSchema(tool.input, { io: "input", target: "draft-7", unrepresentable: "throw" });
      const schema = { ...inputSchema }; delete schema.$schema;
      return { name: tool.name, description: tool.description!, inputSchema: schema };
    });
  }
  register<I, O>(tool: ToolDefinition<I, O>): void {
    if (tool.parallelSafe && (tool.risk !== "read" || !tool.idempotent)) throw new Error("tool_parallel_policy_invalid");
    if (this.#tools.has(tool.name)) throw new Error(`duplicate_tool: ${tool.name}`);
    this.#tools.set(tool.name, tool as ToolDefinition<unknown, unknown>);
  }
  isParallelSafe(name: string): boolean { return this.#tools.get(name)?.parallelSafe === true; }
  isReplaySafe(name: string): boolean { return this.#tools.get(name)?.idempotent === true; }
  resource(name: string): string | undefined { return this.#tools.get(name)?.resource; }
  risk(name: string): ToolRisk | undefined { return this.#tools.get(name)?.risk; }
  preview(name: string, input: unknown, topicId: TopicId): { risk: ToolRisk; input: unknown } {
    const tool = this.#tools.get(name); if (!tool) throw new Error("tool_not_allowed");
    if (!this.allowed(name)) throw new Error("tool_policy_denied");
    if (input && typeof input === "object" && "topicId" in input && input.topicId !== topicId) throw new Error("cross_topic_denied");
    return { risk: tool.risk, input: tool.input.parse(input) };
  }
  async validatedPreview(name: string, input: unknown, context: ToolExecutionContext): Promise<{ risk: ToolRisk; input: unknown; preview?: string }> {
    const preview = this.preview(name, input, context.topicId);
    const tool = this.#tools.get(name)!;
    const signal = AbortSignal.any([context.signal, AbortSignal.timeout(tool.timeoutMs)]);
    if (tool.validate) await withDeadline(tool.validate(preview.input, { ...context, signal }), signal);
    const review = tool.review ? await withDeadline(tool.review(preview.input, { ...context, signal }), signal) : undefined;
    signal.throwIfAborted(); return { ...preview, ...(review ? { preview: review.slice(0, 48_000) } : {}) };
  }
  async execute(name: string, rawInput: unknown, context: ToolExecutionContext): Promise<ToolResult> {
    const tool = this.#tools.get(name); const started = Date.now();
    if (!tool) return { tool: name, ok: false, errorCode: "tool_not_allowed", durationMs: Date.now() - started };
    if (!this.allowed(name)) return { tool: name, ok: false, errorCode: "tool_policy_denied", durationMs: Date.now() - started };
    if (context.signal.aborted) return { tool: name, ok: false, errorCode: "tool_cancelled", durationMs: Date.now() - started };
    // Inspect the raw input: object schemas can strip a model-supplied topicId.
    if (typeof rawInput === "object" && rawInput !== null && "topicId" in rawInput && rawInput.topicId !== context.topicId) return { tool: name, ok: false, errorCode: "cross_topic_denied", durationMs: Date.now() - started };
    if (riskRank(tool.risk) > riskRank(context.maxRisk ?? "read")) return { tool: name, ok: false, errorCode: "tool_policy_denied", durationMs: Date.now() - started };
    let timeout: AbortSignal | undefined; let dispatched = false;
    try {
      const input = tool.input.parse(rawInput);
      timeout = AbortSignal.timeout(tool.timeoutMs);
      const signal = AbortSignal.any([context.signal, timeout]);
      signal.throwIfAborted();
      if (tool.validate) await withDeadline(tool.validate(input, { ...context, signal }), signal);
      signal.throwIfAborted(); dispatched = true;
      const output = await withDeadline(tool.execute(input, { ...context, signal }), signal);
      signal.throwIfAborted();
      const serialized = JSON.stringify(output ?? null);
      let reference: { resultId: string } | undefined;
      if (serialized?.length > 11_000) {
        try { reference = this.results?.retain(context.topicId, serialized); } catch { /* Preserve the actual execution result even if optional archival fails. */ }
      }
      const bounded = boundToolOutput(output, 11_000, reference);
      return { tool: name, ok: true, output: serialized?.length > 11_000 && !reference ? { ...(bounded as object), retention: "unavailable" } : bounded, durationMs: Date.now() - started };
    } catch (error) {
      if (error instanceof ToolOutcomeUnknown) throw error;
      if (dispatched && tool.risk !== "read" && !tool.idempotent && (context.signal.aborted || timeout?.aborted)) throw new ToolOutcomeUnknown();
      const failure = context.signal.aborted ? { ok: false as const, errorCode: "tool_cancelled" } : timeout?.aborted ? { ok: false as const, errorCode: "tool_timeout" } : toolFailure(error);
      return { tool: name, ...failure, durationMs: Date.now() - started };
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
