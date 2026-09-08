import { z } from "zod/v4";
import type { LearningTools } from "./learning-agent.js";
import type { LearningApplication } from "./learning-application.js";
import { projectEditSchema, projectPathSchema, projectBatchSchema, projectPatchSchema } from "./practice-projects.js";
import { TaskExecutionStore, operationKey } from "./task-execution.js";
import type { ToolExecutionContext } from "./tool-harness.js";

export function attachProjectTools(app: LearningApplication, base: LearningTools, topic: string, taskId: string): LearningTools {
  const selected = app.projects.selected(topic); if (!selected) return base;
  const current = (id: string, context: ToolExecutionContext) => { if (context.topicId !== topic || selected !== id || app.projects.selected(topic) !== selected) throw new Error("project_selection_changed"); };

  const projectId = z.literal(selected); const stepId = z.string().regex(/^[a-z0-9_-]{1,40}$/).optional();
  const treeHash = z.string().regex(/^[a-f0-9]{64}$/);
  const tasks = new TaskExecutionStore(app.database);
  const track = async (tool: string, input: Record<string, unknown>, context: ToolExecutionContext, action: () => Promise<unknown>) => {
    current(String(input.projectId), context);
    return tasks.execute(taskId, topic, tool, { ...input, callId: context.callId }, action, async result => {
      if (!await app.projects.verifyOperation(topic, tool, input, result as Record<string, unknown>)) throw new Error("project_result_outdated");
    });
  };
  const receiptKey = (tool: string, input: Record<string, unknown>, context: ToolExecutionContext) => operationKey(tool, { ...Object.fromEntries(Object.entries(input).filter(([key]) => key !== "stepId")), callId: context.callId });
  const receipt = (tool: string, input: Record<string, unknown>, context: ToolExecutionContext) => app.projects.readReceipt(topic, String(input.projectId), receiptKey(tool, input, context));
  const offset = z.number().int().min(0).max(24_000).default(0);

  base.harness.register({ name: "project_status", description: `查看用户选择的实践项目 ${selected} 的文件哈希、项目哈希、Git 差异和测试状态。文件列表每页十项，nextOffset 非空时继续读取。项目计划用 project_file_saved / project_tests_passed / project_checkpoint_saved，并绑定 projectId。`, input: z.object({ projectId, offset }).strict(), risk: "read", idempotent: true, timeoutMs: 10_000, execute: async (input, context) => {
    current(input.projectId, context); const snapshot = await app.projects.snapshot(topic, input.projectId, context.signal); const start = input.offset ?? 0;
    return { projectId: selected, title: snapshot.title, treeHash: snapshot.treeHash, files: snapshot.files.slice(start, start + 10), totalFiles: snapshot.files.length, nextOffset: start + 10 < snapshot.files.length ? start + 10 : null,
      currentTestsPassed: snapshot.currentTestsPassed, head: snapshot.head, branch: snapshot.branch, test: snapshot.test ? { status: snapshot.test.status, exitCode: snapshot.test.exitCode, treeHash: snapshot.test.treeHash, createdAt: snapshot.test.createdAt } : null, diff: snapshot.diff.slice(0, 1800), history: snapshot.history.slice(0, 3), snapshots: snapshot.snapshots.slice(0, 5) };
  } });

  base.harness.register({ name: "project_read", description: "分段读取当前项目的文本文件，返回原文、完整文件哈希和 nextOffset。非空 nextOffset 表示尚未读完。修改前读完需要的内容，并确认各段哈希相同；不能把截断内容当作全文覆盖。", input: z.object({ projectId, path: projectPathSchema, offset }).strict(), risk: "read", idempotent: true, timeoutMs: 5000, execute: async (input, context) => {
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

  base.harness.register({ name: "project_edit", description: "创建或修改当前实践项目的一个文本文件。expectedHash 必须匹配刚读出的文件；新文件填 null。content 为完整新内容，审批展示实际差异。修改会使旧测试状态失效。", input: edit, risk: "write", idempotent: true, timeoutMs: 10_000,
    validate: async (input, context) => { current(input.projectId, context); await app.projects.preview(topic, input.projectId, editValue(input)); },
    review: (input) => app.projects.preview(topic, input.projectId, editValue(input)),
    execute: (input, context) => track("project_edit", input, context, () => app.projects.write(topic, input.projectId, editValue(input), context.signal)),
  });
  const batch = z.object({ projectId, files: projectBatchSchema, stepId }).strict();
  base.harness.register({ name: "project_edit_many", description: "统一校验并修改最多十个文件，失败恢复原状，修改前保留快照。content 为完整内容；null 表示删除该项目文件。expectedHash 匹配原文，新文件填 null。", input: batch, risk: "write", idempotent: true, timeoutMs: 10_000,
    validate: async (input, context) => { current(input.projectId, context); await app.projects.previewMany(topic, input.projectId, input.files); },
    review: input => app.projects.previewMany(topic, input.projectId, input.files),
    execute: (input, context) => track("project_edit_many", input, context, () => app.projects.writeMany(topic, input.projectId, input.files, context.signal)),
  });
  const patch = projectPatchSchema.extend({ projectId, stepId });
  const patchValue = (input: z.infer<typeof patch>) => app.projects.patchValue(topic, input.projectId, { path: input.path, expectedHash: input.expectedHash, replacements: input.replacements });
  base.harness.register({ name: "project_patch", description: "用唯一的原文片段修改文件，避免全文重写。每个 before 必须在原文件中恰好出现一次，片段不可重叠；仍校验完整文件哈希并展示实际差异。", input: patch, risk: "write", idempotent: true, timeoutMs: 10_000,
    validate: async (input, context) => { current(input.projectId, context); if (!await receipt("project_patch", input, context)) await patchValue(input); },
    review: async input => app.projects.preview(topic, input.projectId, await patchValue(input)),
    execute: (input, context) => track("project_patch", input, context, async () => await receipt("project_patch", input, context) ?? app.projects.write(topic, input.projectId, await patchValue(input), context.signal, receiptKey("project_patch", input, context))),
  });
  const restoration = z.object({ projectId, snapshotId: z.string().uuid(), expectedTreeHash: treeHash }).strict();
  base.harness.register({ name: "project_restore", description: "将当前项目恢复到修改前快照，先展示完整差异并取得授权。expectedTreeHash 绑定刚核对的当前项目；恢复不会移动 Git 检查点，恢复前也保留快照，需重新测试。", input: restoration, risk: "write", idempotent: true, timeoutMs: 10_000,
    validate: async (input, context) => { current(input.projectId, context); if (!await receipt("project_restore", input, context)) await app.projects.previewRestore(topic, input.projectId, input.snapshotId, input.expectedTreeHash); },
    review: input => app.projects.previewRestore(topic, input.projectId, input.snapshotId, input.expectedTreeHash),
    execute: (input, context) => track("project_restore", input, context, async () => await receipt("project_restore", input, context) ?? app.projects.restore(topic, input.projectId, input.snapshotId, input.expectedTreeHash, context.signal, receiptKey("project_restore", input, context))),
  });
  const test = z.object({ projectId, expectedTreeHash: treeHash, stepId }).strict();

  base.harness.register({ name: "project_test", description: "在本机已验证的隔离环境执行当前项目所有 .test.mjs 和 test_*.py（Python unittest 标准库），支持嵌套文件导入，返回真实退出码。expectedTreeHash 必须匹配项目状态；不运行 npm 安装、任意 shell 或网络命令。", input: test, risk: "write", idempotent: true, timeoutMs: 15_000,
    review: async input => `运行项目 ${selected} 的 .test.mjs 和 test_*.py 文件。\n项目哈希：${input.expectedTreeHash}\n不授予网络或工作区读写权限。`,
    execute: (input, context) => track("project_test", input, context, async () => { const result = await app.projects.test(topic, input.projectId, input.expectedTreeHash, context.signal); return { ...result, ok: result.status === "completed" && result.exitCode === 0 }; }),
  });
  // eslint-disable-next-line no-control-regex -- Intentionally reject NUL; the API schema requires a Unicode escape instead of legacy \0.
  const checkpoint = test.extend({ title: z.string().trim().min(1).max(120).regex(/^[^\r\n\u0000]+$/) });

  base.harness.register({ name: "project_checkpoint", description: "为当前已经实际通过测试的项目哈希保存本地 Git 检查点。只影响知行独立仓库，不推送网络、不更改导入源。", input: checkpoint, risk: "write", idempotent: true, timeoutMs: 15_000,
    review: async input => `保存本地 Git 检查点：${input.title}\n项目：${selected}\n已测试项目哈希：${input.expectedTreeHash}`,
    execute: (input, context) => track("project_checkpoint", input, context, () => app.projects.checkpoint(topic, input.projectId, input.expectedTreeHash, input.title, context.signal)),
  });
  return { harness: base.harness, definitions: base.harness.definitions() };
}
