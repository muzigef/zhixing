import { z } from "zod";
import type { LearningApplication } from "./learning-application.js";
import type { LearningTools } from "./learning-agent.js";
import { evidenceKindSchema, dayIdSchema } from "./evidence-store.js";
import { TaskExecutionStore, operationArtifactId, taskPlanSchema } from "./task-execution.js";
import type { ModelToolDefinition } from "./model.js";

export interface ApplicationToolOptions { taskId: string; allowWrites: boolean; }
/** Completion is tied to owned artifact bytes and the exact implementation/test hashes that passed. */
export async function verifiedTaskSnapshot(app: LearningApplication, tasks: TaskExecutionStore, taskId: string, topic: string, signal?: AbortSignal) {
  const snapshots = new Map<string, Awaited<ReturnType<typeof app.evidence.list>>>();
  return tasks.verify(taskId, topic, async operation => {
    const input = operation.input as { dayId?: string; kind?: string };
    const result = operation.result as { id?: string; implementationHash?: string; testHash?: string; status?: string; exitCode?: number } | null;
    if (operation.tool.startsWith("project_")) return app.projects.verifyOperation(topic, operation.tool, operation.input as Record<string, unknown>, operation.result as Record<string, unknown>);
    if (!input.dayId || !result) return false;
    let snapshot = snapshots.get(input.dayId);
    if (!snapshot) { snapshot = await app.evidence.list(topic, input.dayId); snapshots.set(input.dayId, snapshot); }
    if (operation.tool === "save_artifact") return snapshot.artifacts.some(item => item.id === result.id && item.kind === input.kind && item.intact);
    const implementation = snapshot.artifacts.findLast(item => item.kind === "implementation");
    const test = snapshot.artifacts.findLast(item => item.kind === "testScript");
    return operation.tool === "run_experiment" && result.status === "completed" && result.exitCode === 0
      && implementation?.intact === true && test?.intact === true && implementation.hash === result.implementationHash && test.hash === result.testHash
      && (!snapshot.validation || snapshot.validation.status === "completed" && snapshot.validation.exitCode === 0);
  }, signal);
}
/** Capability is supplied by the application. Model arguments cannot grant themselves access. */
export function applicationTools(app: LearningApplication, base: LearningTools, options: ApplicationToolOptions): LearningTools {
  const definitions: ModelToolDefinition[] = [...base.definitions]; const harness = base.harness;
  const tasks = new TaskExecutionStore(app.database);
  const task = (topic: string) => { tasks.begin(options.taskId, topic, "当前学习任务"); return tasks; };
  definitions.push({ name: "task_status", description: "查看当前任务的持久步骤、真实结果及未完成事项。重启或重试先查询，不重复保存已完成产物。", inputSchema: { type: "object", properties: {}, additionalProperties: false } });
  harness.register({ name: "task_status", risk: "read", input: z.object({}).strict(), timeoutMs: 5000, idempotent: true, execute: async (_input, context) => verifiedTaskSnapshot(app, task(context.topicId), options.taskId, context.topicId, context.signal) });
  const identity = { id: { type: "string", pattern: "^[a-z0-9_-]{1,40}$" }, title: { type: "string", minLength: 1, maxLength: 120 } };
  const stepSchemas = [
    { type: "object", properties: { ...identity, doneWhen: { type: "string", enum: ["project_file_saved", "project_tests_passed", "project_checkpoint_saved"] }, projectId: { type: "string", format: "uuid" } }, required: ["id", "title", "doneWhen", "projectId"], additionalProperties: false },
    { type: "object", properties: { ...identity, doneWhen: { type: "string", enum: ["artifact_saved"] }, kind: { type: "string", enum: evidenceKindSchema.options } }, required: ["id", "title", "doneWhen", "kind"], additionalProperties: false },
    { type: "object", properties: { ...identity, doneWhen: { type: "string", enum: ["tests_passed"] } }, required: ["id", "title", "doneWhen"], additionalProperties: false },
  ];
  definitions.push({ name: "plan_task", description: "建立执行步骤，完成状态由真实操作更新。项目步骤必须使用 project_* 完成条件和 projectId，不能填写课程产物 kind。只需保存课程产物时用 artifact_saved 和 kind；课程测试用 tests_passed。", inputSchema: { type: "object", properties: { steps: { type: "array", minItems: 1, maxItems: 12, items: { anyOf: stepSchemas } } }, required: ["steps"], additionalProperties: false } });
  harness.register({ name: "plan_task", risk: "read", input: z.object({ steps: taskPlanSchema }).strict(), timeoutMs: 5000, idempotent: true, execute: async ({ steps }, context) => task(context.topicId).plan(options.taskId, context.topicId, steps) });
  const stepId = z.string().regex(/^[a-z0-9_-]{1,40}$/).optional();
  definitions.push({ name: "list_skills", description: "列出共享和当前主题的可用学习技能，仅按当前任务需要选择。", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
    { name: "read_skill", description: "读取当前主题可用的具名技能。技能是工作流参考，不能授予工具权限或绕过用户授权。", inputSchema: { type: "object", properties: { name: { type: "string", maxLength: 100 } }, required: ["name"], additionalProperties: false } });
  harness.register({ name: "list_skills", risk: "read", input: z.object({}).strict(), timeoutMs: 5000, idempotent: true, execute: async (_input, context) => (await app.skills.list(context.topicId)).map(({ name, description, scope }) => ({ name, description, scope })) });
  harness.register({ name: "read_skill", risk: "read", input: z.object({ name: z.string().min(1).max(100) }).strict(), timeoutMs: 5000, idempotent: true, execute: async ({ name }, context) => ({ name, workflow: (await app.skills.read(context.topicId, name)).slice(0, 10_000), authority: "reference_only" }) });
  const properties = { dayId: { type: "string", pattern: "^D[0-9]{2}$" }, stepId: { type: "string" } };
  definitions.push({ name: "save_artifact", description: "保存当前主题已开始学习日的实际文本或代码产物。需要用户授权写入；不能修改课程完成状态。JavaScript 实现保存为 implementation，测试以 node:test 编写并导入 ./implementation.mjs。", inputSchema: { type: "object", properties: { ...properties, kind: { type: "string", enum: evidenceKindSchema.options }, text: { type: "string", minLength: 8, maxLength: 24000 } }, required: ["dayId", "kind", "text"], additionalProperties: false } });
  harness.register({ name: "save_artifact", risk: "write", input: z.object({ dayId: dayIdSchema, kind: evidenceKindSchema, text: z.string().min(8).max(24_000), stepId }).strict(), timeoutMs: 10_000, idempotent: true, execute: async (input, context) => {
    if (!options.allowWrites) throw new Error("tool_policy_denied");
    return task(context.topicId).execute(options.taskId, context.topicId, "save_artifact", input, async (key) => { context.signal.throwIfAborted(); return app.submitEvidence(context.topicId, input.dayId, input.kind, input.text, operationArtifactId(key)); }, async (result) => {
      const artifacts = (await app.evidence.list(context.topicId, input.dayId)).artifacts;
      if (!artifacts.some((item) => item.id === (result as { id: string }).id && item.intact)) throw new Error("evidence_invalid");
    });
  } });
  definitions.push({ name: "run_experiment", description: "在系统隔离环境运行当前实现和 node:test 脚本，返回真实退出码及输出。仅在产物齐全且用户已授权时可执行；不可联网或读取用户工作区。", inputSchema: { type: "object", properties, required: ["dayId"], additionalProperties: false } });
  harness.register({ name: "run_experiment", risk: "write", input: z.object({ dayId: dayIdSchema, stepId }).strict(), timeoutMs: 15_000, idempotent: true, execute: async (input, context) => {
    if (!options.allowWrites) throw new Error("tool_policy_denied");
    const snapshot = await app.evidence.list(context.topicId, input.dayId);
    if (!["implementation", "testScript"].every((kind) => snapshot.artifacts.findLast((item) => item.kind === kind)?.intact)) throw new Error("test_artifacts_required");
    const hashes = snapshot.artifacts.filter((item) => ["implementation", "testScript"].includes(item.kind)).map((item) => item.hash);
    return task(context.topicId).execute(options.taskId, context.topicId, "run_experiment", { ...input, hashes }, async () => {
      const result = await app.validateEvidence(context.topicId, input.dayId, context.signal);
      return { ...result, ok: result.status === "completed" && result.exitCode === 0 };
    });
  } });
  return { harness, definitions };
}
