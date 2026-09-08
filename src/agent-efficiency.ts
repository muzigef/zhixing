import { z } from "zod/v4";
import type { ModelEvent, ModelToolDefinition, ReasoningProfile } from "./model.js";
import type { LearningTools } from "./learning-agent.js";

export function selectReasoning(text: string, requested: ReasoningProfile | "auto" = "balanced", execution = false): ReasoningProfile {
  if (requested !== "auto") return requested;
  if (execution || /推导|证明|梯度|反例|并发|竞态|深度分析|逐步分析|prove|deriv|race condition/i.test(text)) return "deep";
  if (text.length > 120 || /```|\$\$|比较|设计|分析|解释.*原因/.test(text)) return "balanced";
  return "quick";
}

const categorySchema = z.enum(["practice", "skills", "external", "project"]);
type Category = z.infer<typeof categorySchema>;
function categoryOf(name: string): Category | undefined {
  if (["plan_task", "save_artifact", "run_experiment"].includes(name)) return "practice";
  if (["read_skill", "list_skills"].includes(name)) return "skills";
  if (name.startsWith("mcp_")) return "external";
  if (name.startsWith("project_")) return "project";
  return undefined;
}
function inCategory(name: string, category: Category): boolean { return categoryOf(name) === category || name === "plan_task" && category === "project"; }

/** Schema discovery is an efficiency policy; the full harness still owns authorization. */
export function onDemandTools(base: LearningTools, previousCalls: readonly ModelEvent[] = [], practiceActive = false, lazy?: { categories: Category[]; prepare: (category: Category, signal: AbortSignal) => Promise<void> }) {
  const enabled = new Set<Category>(practiceActive ? ["practice"] : []);
  for (const call of previousCalls) {
    if (call.type !== "tool_call") continue;
    const restored = categoryOf(call.tool ?? ""); if (restored) enabled.add(restored);
    if (call.tool === "discover_tools") {
      const category = categorySchema.safeParse((call.input as { category?: unknown })?.category);
      if (category.success) enabled.add(category.data);
    }
  }
  const available = categorySchema.options.filter(category => lazy?.categories.includes(category) || base.definitions.some(tool => categoryOf(tool.name) === category));
  if (!available.length) return { ...base, advertised: () => base.definitions };
  const discovery: ModelToolDefinition = { name: "discover_tools", description: "按当前任务需要加载工具定义。practice 用于保存实现和运行实验；skills 用于读取工作流；external 用于已配置的外部服务；project 用于已连接的实践项目。发现工具不会授予执行权限。", inputSchema: { type: "object", properties: { category: { type: "string", enum: available } }, required: ["category"], additionalProperties: false } };
  let definitions: ModelToolDefinition[] = [];
  base.harness.register({ name: discovery.name, description: discovery.description, input: z.object({ category: z.enum(available as [Category, ...Category[]]) }).strict(), risk: "read", idempotent: true, timeoutMs: lazy ? 12_000 : 1000, execute: async ({ category }, context) => {
    if (!available.includes(category)) return { ok: false, errorCode: "tool_not_available" };
    if (lazy?.categories.includes(category)) { await lazy.prepare(category, context.signal); definitions.splice(0, definitions.length, ...base.harness.definitions()); }
    enabled.add(category);
    return { category, tools: definitions.filter(tool => inCategory(tool.name, category)).map(tool => ({ name: tool.name, description: tool.description })), permission: "unchanged" };
  } });
  definitions = base.harness.definitions();
  return { harness: base.harness, definitions, advertised: () => definitions.filter(tool => !categoryOf(tool.name) || [...enabled].some(category => inCategory(tool.name, category))) };
}
