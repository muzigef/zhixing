import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LearningApplication } from "../src/learning-application.js";
import { MacOSKeychainSecretStore } from "../src/macos-keychain.js";
import { DeepSeekClient } from "../src/deepseek-client.js";
import { PiApplicationClient } from "../src/pi-application-client.js";
import { DesktopService } from "../desktop/core/service.js";
import { DesktopStore } from "../desktop/core/store.js";
import { resolvePackagedPiSdk } from "../desktop/core/pi-runner.js";
import { AgentExecutionStore } from "../src/agent-execution-store.js";

if (!process.argv.includes("--live") || process.env.ZHIXING_ALLOW_LIVE_PROVIDER === "0") throw new Error("live_provider_disabled");
const provider = process.argv.find(value => value.startsWith("--provider="))?.slice(11) ?? "pi-codex";
if (!["pi-codex", "deepseek-api"].includes(provider)) throw new Error("provider_invalid");
const root = process.cwd(); const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-project-live-"));
const output = path.resolve(process.argv.find(value => value.startsWith("--output="))?.slice(9) ?? `docs/evidence/project-live-${provider}-${Date.now()}.json`);
await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, "{}\n", { flag: "wx", mode: 0o600 });
let app: LearningApplication | undefined;
try {
  app = await LearningApplication.open(path.join(temporary, "workspace"), root);
  const before = await app.projects.create("rag", "临时合成项目", new AbortController().signal); app.projects.select("rag", before.id);
  const original = await app.projects.read("rag", before.id, "README.md");
  const pi = new PiApplicationClient({ projectDir: root, executable: process.execPath, sdk: await resolvePackagedPiSdk(path.join(root, "desktop")), worker: path.join(root, "desktop/build/runtime/pi-model-worker.mjs") });
  const transport: { status: number; fields?: string[] }[] = [];
  const deepseek = new DeepSeekClient(new MacOSKeychainSecretStore(), async (url, options) => {
    const response = await fetch(url, options);
    const observation: { status: number; fields?: string[] } = { status: response.status };
    if (!response.ok) {
      const data = await response.clone().json().catch(() => ({})) as { error?: { message?: unknown } };
      const message = typeof data.error?.message === "string" ? data.error.message : "";
      observation.fields = ["reasoning_content", "tool_calls", "max_tokens", "parameters", "schema", "pattern", "oneOf", "anyOf", "additionalProperties", "required", "strict", "object", "array", "null", "integer", "number", "string", "boolean", "type", "enum", "const", "minimum", "maximum", "patternProperties", "minItems", "maxItems", "plan_task", "project_status", "project_read", "project_edit", "project_edit_many", "project_patch", "project_restore", "project_test", "project_checkpoint"].filter(field => message.includes(field));
    }
    transport.push(observation); return response;
  });
  const store = new DesktopStore(path.join(temporary, "sessions"));
  const service = new DesktopService(store, id => id === "pi-codex" ? pi : deepseek, app);
  const session = await service.create();
  const taskStarted = Date.now();
  await service.send({ sessionId: session.id, provider: provider as "pi-codex" | "deepseek-api", topicId: "rag", access: { materials: false, project: true, external: false }, execution: "read", style: "adaptive", reasoning: "balanced", text: "这是临时合成项目的接入验收。请使用当前连接的项目工具，在 README.md 末尾添加一行“合成项目验证：已检查示例文件。”，保留原有内容。不要改其他文件。建立包含修改、实际测试、Git 检查点的项目计划，运行已有 .test.mjs，测试通过后保存本地 Git 检查点，再简短说明结果。无需查询学习资料或外部工具，不要只给出操作建议。" });
  await service.idle();
  const approvals: string[] = [];
  for (let count = 0; count < 6; count++) {
    const current = await service.load(session.id);
    if (current.messages.at(-1)?.status !== "waiting") break;
    const card = current.messages.flatMap(message => message.items ?? []).find(item => item.kind === "approval" && item.status === "pending");
    if (!card || card.kind !== "approval") break;
    const args = card.input as Record<string, unknown>;
    const allowed = args.projectId === before.id && (["project_test", "project_checkpoint"].includes(card.tool) || ["project_edit", "project_patch"].includes(card.tool) && args.path === "README.md");
    if (!allowed) throw new Error("synthetic_approval_out_of_scope");
    approvals.push(card.tool);
    await service.answerInteraction(session.id, card.id, "allow", "once"); await service.idle();
  }
  const message = (await service.load(session.id)).messages.at(-1)!; const after = await app.projects.snapshot("rag", before.id);
  const readme = await app.projects.read("rag", before.id, "README.md");
  const checks = { completed: message.status === "completed", preservedReadme: readme.content.startsWith(original.content), marker: readme.content.includes("合成项目验证：已检查示例文件。"), otherFilesIntact: before.files.filter(file => file.path !== "README.md").every(file => after.files.find(next => next.path === file.path)?.hash === file.hash), actualTestsPassed: after.currentTestsPassed, newCheckpoint: after.head !== before.head && !after.diff };
  const execution = message.taskId ? new AgentExecutionStore(app.database, { taskId: message.taskId, sessionId: session.id, topicId: "rag" }).read() : undefined;
  const report = { taskDurationMs: Date.now() - taskStarted, transport, provenance: await app.provenance(), approvals, generatedAt: new Date().toISOString(), scope: "One synthetic project; controlled configured provider; not a learning-effect or broad quality evaluation", provider, model: message.model ?? (provider === "pi-codex" ? (await pi.selection().catch(() => undefined))?.model : "deepseek-v4-flash"), checks, passed: Object.values(checks).every(Boolean), answer: message, project: after, readme: { before: original.content, after: readme.content }, trace: execution ? [...execution.history, ...(execution.pending ? [execution.pending] : [])] : [] };
  await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ provider, checks, status: message.status, taskDurationMs: report.taskDurationMs, finalSegmentMs: message.durationMs, timings: message.timings }));
  if (!report.passed) process.exitCode = 1;
} finally { app?.close(); await fs.rm(temporary, { recursive: true, force: true }); }
