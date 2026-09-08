import { z } from "zod";
import type { LearningTools } from "./learning-agent.js";
import type { LearningApplication } from "./learning-application.js";
import { projectEditSchema, projectPathSchema } from "./practice-projects.js";
import { TaskExecutionStore } from "./task-execution.js";
import type { ModelToolDefinition } from "./model.js";
import type { ToolExecutionContext } from "./tool-harness.js";

export function attachProjectTools(app: LearningApplication, base: LearningTools, topic: string, taskId: string): LearningTools {
  const selected = app.projects.selected(topic); if (!selected) return base;
  const current = (id: string, context: ToolExecutionContext) => { if (context.topicId !== topic || selected !== id || app.projects.selected(topic) !== selected) throw new Error("project_selection_changed"); };
  const definitions: ModelToolDefinition[] = [...base.definitions];
  const projectId = z.literal(selected); const stepId = z.string().regex(/^[a-z0-9_-]{1,40}$/).optional();
  const treeHash = z.string().regex(/^[a-f0-9]{64}$/);
  const idProperty = { projectId: { type: "string", const: selected } }; const stepProperty = { stepId: { type: "string" } };
  const tasks = new TaskExecutionStore(app.database);
  const track = async (tool: string, input: Record<string, unknown>, context: ToolExecutionContext, action: () => Promise<unknown>) => {
    current(String(input.projectId), context);
    return tasks.execute(taskId, topic, tool, { ...input, callId: context.callId }, action, async result => {
      if (!await app.projects.verifyOperation(topic, tool, input, result as Record<string, unknown>)) throw new Error("project_result_outdated");
    });
  };
  const offset = z.number().int().min(0).max(24_000).default(0);
  definitions.push({ name: "project_status", description: `查看用户选择的实践项目 ${selected} 的文件哈希、项目哈希、Git 差异和测试状态。文件列表每页十项，nextOffset 非空时继续读取。项目计划用 project_file_saved / project_tests_passed / project_checkpoint_saved，并绑定 projectId。`, inputSchema: { type: "object", properties: { ...idProperty, offset: { type: "integer", minimum: 0 } }, required: ["projectId"], additionalProperties: false } });
  base.harness.register({ name: "project_status", input: z.object({ projectId, offset }).strict(), risk: "read", idempotent: true, timeoutMs: 10_000, execute: async (input, context) => {
    current(input.projectId, context); const snapshot = await app.projects.snapshot(topic, input.projectId, context.signal); const start = input.offset ?? 0;
    return { projectId: selected, title: snapshot.title, treeHash: snapshot.treeHash, files: snapshot.files.slice(start, start + 10), totalFiles: snapshot.files.length, nextOffset: start + 10 < snapshot.files.length ? start + 10 : null,
      currentTestsPassed: snapshot.currentTestsPassed, head: snapshot.head, branch: snapshot.branch, test: snapshot.test ? { status: snapshot.test.status, exitCode: snapshot.test.exitCode, treeHash: snapshot.test.treeHash, createdAt: snapshot.test.createdAt } : null, diff: snapshot.diff.slice(0, 1800), history: snapshot.history.slice(0, 3) };
  } });
  definitions.push({ name: "project_read", description: "分段读取当前项目的文本文件，返回原文、完整文件哈希和 nextOffset。非空 nextOffset 表示尚未读完。修改前读完需要的内容，并确认各段哈希相同；不能把截断内容当作全文覆盖。", inputSchema: { type: "object", properties: { ...idProperty, path: { type: "string", maxLength: 300 }, offset: { type: "integer", minimum: 0, maximum: 24000 } }, required: ["projectId", "path"], additionalProperties: false } });
  base.harness.register({ name: "project_read", input: z.object({ projectId, path: projectPathSchema, offset }).strict(), risk: "read", idempotent: true, timeoutMs: 5000, execute: async (input, context) => {
    current(input.projectId, context); const file = await app.projects.read(topic, input.projectId, input.path);
    const start = input.offset ?? 0;
    if (start > file.content.length) throw new Error("project_file_conflict");
    let chunk = file.content.slice(start, start + 4000);
    while (JSON.stringify(chunk).length > 8500) chunk = chunk.slice(0, Math.floor(chunk.length / 2));
    if (/[\uD800-\uDBFF]$/.test(chunk)) chunk = chunk.slice(0, -1);
    const end = start + chunk.length;
    return { path: file.path, hash: file.hash, bytes: file.bytes, totalChars: file.content.length, offset: start, content: chunk, nextOffset: end < file.content.length ? end : null };
  } });
  const edit = projectEditSchema.extend({ projectId, stepId });
  const editValue = (input: z.infer<typeof edit>) => ({ path: input.path, expectedHash: input.expectedHash, content: input.content });
  definitions.push({ name: "project_edit", description: "创建或修改当前实践项目的一个文本文件。expectedHash 必须匹配刚读出的文件；新文件填 null。content 为完整新内容，审批展示实际差异。修改会使旧测试状态失效。", inputSchema: { type: "object", properties: { ...idProperty, ...stepProperty, path: { type: "string", maxLength: 300 }, expectedHash: { type: ["string", "null"] }, content: { type: "string", maxLength: 24000 } }, required: ["projectId", "path", "expectedHash", "content"], additionalProperties: false } });
  base.harness.register({ name: "project_edit", input: edit, risk: "write", idempotent: true, timeoutMs: 10_000,
    validate: async (input, context) => { current(input.projectId, context); await app.projects.preview(topic, input.projectId, editValue(input)); },
    review: (input) => app.projects.preview(topic, input.projectId, editValue(input)),
    execute: (input, context) => track("project_edit", input, context, () => app.projects.write(topic, input.projectId, editValue(input), context.signal)),
  });
  const test = z.object({ projectId, expectedTreeHash: treeHash, stepId }).strict();
  const treeProperties = { ...idProperty, ...stepProperty, expectedTreeHash: { type: "string", pattern: "^[a-f0-9]{64}$" } };
  definitions.push({ name: "project_test", description: "在本机已验证的隔离环境执行当前项目所有 .test.mjs，支持嵌套文件导入，返回真实退出码。expectedTreeHash 必须匹配项目状态；不运行 npm 安装、任意 shell 或网络命令。", inputSchema: { type: "object", properties: treeProperties, required: ["projectId", "expectedTreeHash"], additionalProperties: false } });
  base.harness.register({ name: "project_test", input: test, risk: "write", idempotent: true, timeoutMs: 15_000,
    review: async input => `运行项目 ${selected} 的 .test.mjs 文件。\n项目哈希：${input.expectedTreeHash}\n不授予网络或工作区读写权限。`,
    execute: (input, context) => track("project_test", input, context, async () => { const result = await app.projects.test(topic, input.projectId, input.expectedTreeHash, context.signal); return { ...result, ok: result.status === "completed" && result.exitCode === 0 }; }),
  });
  const checkpoint = test.extend({ title: z.string().trim().min(1).max(120).regex(/^[^\r\n\0]+$/) });
  definitions.push({ name: "project_checkpoint", description: "为当前已经实际通过测试的项目哈希保存本地 Git 检查点。只影响知行独立仓库，不推送网络、不更改导入源。", inputSchema: { type: "object", properties: { ...treeProperties, title: { type: "string", minLength: 1, maxLength: 120 } }, required: ["projectId", "expectedTreeHash", "title"], additionalProperties: false } });
  base.harness.register({ name: "project_checkpoint", input: checkpoint, risk: "write", idempotent: true, timeoutMs: 15_000,
    review: async input => `保存本地 Git 检查点：${input.title}\n项目：${selected}\n已测试项目哈希：${input.expectedTreeHash}`,
    execute: (input, context) => track("project_checkpoint", input, context, () => app.projects.checkpoint(topic, input.projectId, input.expectedTreeHash, input.title, context.signal)),
  });
  return { harness: base.harness, definitions };
}
