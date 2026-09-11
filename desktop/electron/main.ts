import { nativeRuntimeCatalog } from "../../src/native-runtime-catalog.js";
import { ApiConnections } from "../../src/api-connections.js";
import { nativeBackend } from "../../src/native-agent.js";
import { evaluateTeams, type EvaluationProgress } from "../../src/team-evaluation.js";
import os from "node:os";
import { isCustomProvider, type ApiConnection, type CustomProvider } from "../../src/api-connection-config.js";
import { ReminderStore, ReminderScheduler } from "../../src/reminder-store.js";
import { executionSupport } from "../../src/platform-support.js";
import { skillMetadata } from "../../src/skill-catalog.js";
import { AgentEventCoalescer } from "../../src/agent-events.js";
import { McpSettings, McpConnection } from "../../src/mcp-tools.js";
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  Notification,
  net,
  protocol,
  shell,
} from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createAgentModel } from "../../src/agent-model-factory.js";
import { desktopSecrets } from "./secrets.js";
import type { EncryptedDesktopSecrets } from "../core/secrets.js";
import { PiApplicationClient } from "../../src/pi-application-client.js";
import { createWorkspaceBackup, inspectWorkspaceBackup, restoreWorkspaceBackup } from "../core/workspace-backup.js";
import { DesktopStore } from "../core/store.js";
import {
  DesktopDemoClient,
  DesktopService,
  publicError,
} from "../core/service.js";
import {
  desktopCommandSchema,
  type BootState,
  type ModelStatus,
} from "../core/contracts.js";
import { resolvePackagedPiSdk } from "../core/pi-runner.js";
import { LearningApplication } from "../../src/learning-application.js";
import { summarizeOutcomes } from "../../src/learning-outcomes.js";
import { summarizePerformance } from "../core/diagnostics.js";
import { checkRelease } from "../core/updates.js";
import { withModelBudget } from "../../src/model-capabilities.js";
import type { ContextBudget } from "../../src/context-window.js";
import { checkApiConnection } from "../../src/api-connection.js";

const directory = path.dirname(fileURLToPath(import.meta.url));
const origin = "zhixing://app";
protocol.registerSchemesAsPrivileged([
  {
    scheme: "zhixing",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
app.setName("知行");
app.setPath("userData", path.join(app.getPath("appData"), "Zhixing"));
// Automated UI checks always supply an isolated temporary data directory.
if (process.env.ZHIXING_DESKTOP_TEST_DATA)
  app.setPath("userData", process.env.ZHIXING_DESKTOP_TEST_DATA);
const lock = app.requestSingleInstanceLock();
let window: BrowserWindow | null = null;
let service: DesktopService;
let pi: PiApplicationClient;
let secrets: EncryptedDesktopSecrets;
let kimiSecrets: EncryptedDesktopSecrets;
let checkingApi = false;
let evaluationController: AbortController | undefined;
let evaluationIdle: Promise<unknown> = Promise.resolve();
let evaluationProgress: EvaluationProgress | undefined;
let apiConnections: ApiConnections;
let connectionProfiles: ApiConnection[] = [];
const customSecrets = new Map<CustomProvider, EncryptedDesktopSecrets>();
function secretsFor(provider: "deepseek-api" | "kimi-api" | CustomProvider): EncryptedDesktopSecrets {
  if (provider === "deepseek-api") return secrets;
  if (provider === "kimi-api") return kimiSecrets;
  if (!customSecrets.has(provider)) customSecrets.set(provider, desktopSecrets(app.getPath("userData"), provider));
  return customSecrets.get(provider)!;
}
function apiModel(provider: "deepseek-api" | "kimi-api" | CustomProvider) {
  return createAgentModel(provider, { pi, secrets: secretsFor(provider), connection: connectionProfiles.find(item => item.id === provider), fetcher: (url, options) => net.fetch(url, options), deepseekModel, contextBudget });
}
let deepseekModel = "deepseek-v4-flash";
let nativeClaudeExecutable: string | undefined;
let nativeCodexExecutable: string | undefined;
let nativeCodexModel: string | undefined;
function nativeSettingsEnvironment(): NodeJS.ProcessEnv {
  return { ...process.env, ...(nativeClaudeExecutable ? { ZHIXING_CLAUDE_EXECUTABLE: nativeClaudeExecutable } : {}), ...(nativeCodexExecutable ? { ZHIXING_CODEX_EXECUTABLE: nativeCodexExecutable } : {}), ...(nativeCodexModel ? { ZHIXING_CODEX_MODEL: nativeCodexModel } : {}) };
}
let semanticModel = "";
let contextBudget: ContextBudget | undefined;
let quitting = false;
let reminderScheduler: ReminderScheduler | undefined;
let learning: LearningApplication;
let learningController: AbortController | undefined;
let learningIdle: Promise<void> = Promise.resolve();
let finishLearning: (() => void) | undefined;
function beginLearning(): void { learningController = new AbortController(); learningIdle = new Promise<void>((resolve) => { finishLearning = resolve; }); }
function endLearning(): void { learningController = undefined; finishLearning?.(); finishLearning = undefined; }

function connectService(store: DesktopStore): void {
  reminderScheduler?.stop();
  const workspace = learning;
  reminderScheduler = new ReminderScheduler(new ReminderStore(workspace.paths), () => workspace.registry.list().map(topic => topic.topicId), topics => {
    if (!Notification.isSupported()) return;
    const notification = new Notification({ title: "知行 · 复习时间到了", body: `${topics.length} 个主题到了复习时间。用自己的话回忆一个概念，再试一道题。` });
    notification.on("failed", () => console.warn("reminder_delivery_unavailable"));
    notification.on("click", () => {
      if (window && !window.isDestroyed()) { window.show(); window.focus(); }
      else void createWindow().catch(() => console.warn("reminder_window_unavailable"));
    }); notification.show();
  }, () => console.warn("reminder_delivery_unavailable"));
  if (Notification.isSupported()) reminderScheduler.start();
  learning.configureSemantic(semanticModel);
  service = new DesktopService(store, provider => {
    const native = nativeBackend(provider, nativeSettingsEnvironment(), contextBudget);
    if (native) return native;
    if (provider === "demo") return withModelBudget(new DesktopDemoClient(), contextBudget);
    if (provider === "pi-codex") return createAgentModel(provider, { pi, secrets, contextBudget });
    if (provider === "deepseek-api" || provider === "kimi-api" || isCustomProvider(provider)) return apiModel(provider);
    throw new Error("provider_not_found");
  }, learning);
  const events = new AgentEventCoalescer(event => { if (window && !window.isDestroyed()) window.webContents.send("zhixing:event", event); });
  service.subscribe(event => events.push(event));
}

async function modelStatus(): Promise<ModelStatus> {
  try {
    const model = await pi.selection();
    return {
      configured: true,
      ...model,
      provider: "pi-codex",
      message: "已读取 Pi 模型配置；登录状态将在发送时检查。",
    };
  } catch {
    return {
      configured: false,
      provider: "pi-codex",
      message: "在 Pi 中选择 OpenAI Codex 模型并登录，然后点刷新。",
    };
  }
}
async function apiStatus(store: EncryptedDesktopSecrets, name: string, model: string) {
  let status: { configured: boolean; source?: "desktop" | "system-keychain" };
  try { status = await store.status(); } catch { status = { configured: false }; }
  return { ...status, model, message: status.configured
    ? status.source === "system-keychain" ? "已找到现有知行 API 配置，可直接使用。有效性将在发送时检查。" : "API Key 已由系统加密保存。有效性将在发送时检查。"
    : `未找到现有 ${name} 配置，可在下方添加 API Key。` };
}
async function boot(): Promise<BootState> {
  const settings = await service.store.settings();
  const page = await service.store.page();
  const profiles = await apiConnections.load(); connectionProfiles = profiles.connections;
  return {
    workspace: learning.summary(),
    sessions: page.sessions, nextSessionCursor: page.nextCursor,
    settings,
    apiConnections: { revision: profiles.revision, connections: await Promise.all(profiles.connections.map(async connection => ({ ...connection, configured: (await apiStatus(secretsFor(connection.id), connection.name, connection.model)).configured }))) },
    model: await modelStatus(),
    activeSessionId: service.activeSessionId,
    api: await apiStatus(secrets, "DeepSeek", settings.deepseekModel),
    kimiApi: await apiStatus(kimiSecrets, "Kimi", "kimi-k3"),
  };
}
async function createWindow(): Promise<void> {
  window = new BrowserWindow({
    width: 1260,
    height: 840,
    minWidth: 760,
    minHeight: 560,
    show: false,
    title: "知行",
    backgroundColor: "#fbfaf8",
    titleBarStyle: "hiddenInset",
    ...(process.platform === "win32"
      ? {
          titleBarOverlay: {
            color: "#fbfaf8",
            symbolColor: "#272727",
            height: 44,
          },
        }
      : {}),
    trafficLightPosition: { x: 18, y: 18 },
    webPreferences: {
      preload: path.join(directory, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.once("ready-to-show", () => window?.show());
  window.on("closed", () => {
    window = null;
  });
  await window.loadURL(`${origin}/index.html`);
}
if (!lock) app.quit();
else {
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      const root = app.getPath("userData");
      const runtime = path.join(root, "runtime");
      await fs.mkdir(runtime, { recursive: true, mode: 0o700 });
      const resources = app.isPackaged
        ? path.join(process.resourcesPath, "runtime")
        : path.join(directory, "runtime");
      await fs.copyFile(
        path.join(resources, "AGENTS.md"),
        path.join(runtime, "AGENTS.md"),
      );
      pi = new PiApplicationClient({
        projectDir: runtime,
        executable: process.execPath,
        worker: path.join(resources, "pi-model-worker.mjs"),
        sdk: await resolvePackagedPiSdk(app.getAppPath()),
      });
      secrets = desktopSecrets(root);
      kimiSecrets = desktopSecrets(root, "kimi-api");
      apiConnections = new ApiConnections(path.join(root, "api-connections.json"));
      connectionProfiles = (await apiConnections.load()).connections;
      const store = new DesktopStore(root);
      deepseekModel = (await store.settings()).deepseekModel;
      semanticModel = (await store.settings()).semanticModel ?? "";
      contextBudget = (await store.settings()).contextBudget;
      nativeClaudeExecutable = (await store.settings()).nativeClaudeExecutable;
      nativeCodexExecutable = (await store.settings()).nativeCodexExecutable;
      nativeCodexModel = (await store.settings()).nativeCodexModel;
      learning = await LearningApplication.open(await store.workspace() ?? path.join(root, "workspace"), resources);
      connectService(store);
      protocol.handle("zhixing", (request) => {
        const url = new URL(request.url);
        if (url.host !== "app" || request.method !== "GET")
          return new Response("Forbidden", { status: 403 });
        const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "");
        const base = path.join(directory, "renderer");
        const target = path.resolve(base, relative || "index.html");
        if (!target.startsWith(`${base}${path.sep}`))
          return new Response("Forbidden", { status: 403 });
        return net.fetch(pathToFileURL(target).toString());
      });
      ipcMain.handle("zhixing:command", async (event, raw: unknown) => {
        try {
          if (
            !window ||
            event.sender !== window.webContents ||
            event.senderFrame !== window.webContents.mainFrame ||
            event.senderFrame?.url !== `${origin}/index.html`
          )
            throw new Error("invalid_sender");
          const command = desktopCommandSchema.parse(raw);
          if (checkingApi && ["team-evaluate", "check-api", "configure-deepseek", "configure-kimi", "api-connection-save", "api-connection-remove", "settings", "send", "enqueue", "answer", "resume-queue", "workspace-backup", "workspace-restore"].includes(command.type)) throw new Error("learning_busy");
          if (learningController && ["new", "fork", "answer", "enqueue", "resume-queue", "withdraw", "context", "permissions", "rename", "settings", "configure-deepseek", "configure-kimi", "workspace-select", "workspace-backup", "workspace-restore"].includes(command.type)) throw new Error("learning_busy");
          let data: unknown;
          switch (command.type) {
            case "native-agent-status":
              data = await Promise.all(nativeRuntimeCatalog.map(entry => nativeBackend(entry.provider, nativeSettingsEnvironment())!.status(new AbortController().signal)));
              break;
            case "reminder-status":
            case "reminder-save": {
              learning.registry.get(command.topicId); const reminders = new ReminderStore(learning.paths);
              if (command.type === "reminder-save") { if (command.enabled) await reminders.set(command.topicId, command.time); else await reminders.disable(command.topicId); }
              data = await reminders.status(command.topicId) ?? null; break;
            }

            case "diagnostics": {
              const sessions = await service.store.list();
              const recent = await Promise.all(sessions.slice(0, 20).map((session) => service.load(session.id)));
              data = { version: app.getVersion(), connections: connectionProfiles, execution: executionSupport(), performance: summarizePerformance(recent.flatMap((session) => session.messages).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-200)) };
              break;
            }
            case "check-updates":
              if (process.env.ZHIXING_ALLOW_LIVE_PROVIDER === "0") throw new Error("live_provider_disabled");
              data = await checkRelease(app.getVersion(), (url, options) => net.fetch(url instanceof URL ? url.toString() : url, options));
              break;
            case "evidence-list":
              learning.registry.get(command.topicId);
              data = await learning.evidence.list(command.topicId, command.dayId);
              break;
            case "evidence-submit":
            case "evidence-file":
            case "evidence-review":
            case "evidence-validate": {
              if (learningController || service.activeSessionId) throw new Error("learning_busy");
              beginLearning();
              try {
                if (command.type === "evidence-submit") data = await learning.submitEvidence(command.topicId, command.dayId, command.kind, command.text);
                else if (command.type === "evidence-file") {
                  const selected = await dialog.showOpenDialog(window, { title: "提交当前学习日的证据", properties: ["openFile"], filters: [{ name: "文本与代码", extensions: ["txt", "md", "log", "js", "mjs", "cjs", "ts", "tsx", "py", "java", "rs", "go", "cpp", "c", "h"] }] });
                  if (selected.canceled || !selected.filePaths[0]) data = { cancelled: true };
                  else { learningController!.signal.throwIfAborted(); data = await learning.submitEvidenceFile(command.topicId, command.dayId, command.kind, selected.filePaths[0]); }
                } else if (command.type === "evidence-review") data = await learning.review(command.topicId, command.dayId);
                else data = await learning.validateEvidence(command.topicId, command.dayId, learningController!.signal);
              } finally { endLearning(); }
              break;
            }
            case "learning-overview":
              data = await learning.overview(command.topicId);
              break;
            case "assessment-start":
              if (learningController || service.activeSessionId) throw new Error("learning_busy");
              data = await learning.startAssessment(command.topicId, command.dayId);
              break;
            case "outcome-list": {
              learning.registry.get(command.topicId);
              const trials = learning.outcomes.list(command.topicId);
              data = { trials, report: summarizeOutcomes(trials) };
              break;
            }
            case "outcome-export": {
              if (learningController || service.activeSessionId) throw new Error("learning_busy");
              learning.registry.get(command.topicId);
              const trials = learning.outcomes.list(command.topicId);
              const report = { version: 1, exportedAt: new Date().toISOString(), topicId: command.topicId, assignment: "learner_selected", trials, summary: summarizeOutcomes(trials) };
              const selected = await dialog.showSaveDialog(window, { title: "导出本地学习验证（包含你的作答）", defaultPath: `zhixing-outcomes-${command.topicId}.json`, filters: [{ name: "JSON", extensions: ["json"] }] });
              if (!selected.canceled && selected.filePath) await fs.writeFile(selected.filePath, JSON.stringify(report, null, 2), { encoding: "utf8", mode: 0o600 });
              data = { cancelled: selected.canceled };
              break;
            }
            case "outcome-start":
            case "outcome-submit":
            case "outcome-lesson":
            case "outcome-finish-lesson":
            case "outcome-retention":
            case "outcome-abandon": {
              if (learningController || service.activeSessionId) throw new Error("learning_busy");
              learning.registry.get(command.topicId); beginLearning();
              try {
                if (command.type === "outcome-start") data = learning.outcomes.start(command.topicId, command.mode, command.protocol);
                else if (command.type === "outcome-submit") data = learning.outcomes.submit(command.topicId, command.id, command.phase, command.submission);
                else if (command.type === "outcome-lesson") data = await service.openOutcomeLesson(command.topicId, command.id);
                else if (command.type === "outcome-finish-lesson") data = await service.finishOutcomeLesson(command.topicId, command.id);
                else if (command.type === "outcome-retention") data = learning.outcomes.openRetention(command.topicId, command.id);
                else data = learning.outcomes.abandon(command.topicId, command.id);
              } finally { endLearning(); }
              break;
            }
            case "assessment-submit":
              if (learningController || service.activeSessionId) throw new Error("learning_busy");
              data = await learning.submitAssessment(command.topicId, command.dayId, command.attemptId, command.answers, command.reflection, command.assistance);
              break;
            case "observation-update":
              if (learningController || service.activeSessionId) throw new Error("learning_busy");
              learning.registry.get(command.topicId);
              data = learning.observations.update(command.topicId, command.id, command.revision, command.annotation, command.withdrawn);
              break;
            case "outcome-review-explanation":
              if (learningController || service.activeSessionId) throw new Error("learning_busy");
              learning.registry.get(command.topicId);
              data = learning.outcomes.reviewExplanation(command.topicId, command.id, command.phase, command.review);
              break;
            case "learning-source":
              data = await learning.source(command.topicId, command.citation);
              break;
            case "task-info": data = await service.taskInfo(command.sessionId, command.taskId); break;
            case "task-report":
              if (learningController) throw new Error("learning_busy");
              data = await service.reportRecovery(command.sessionId, command.taskId, command.callId, command.report); break;
            case "task-verify":
              if (learningController) throw new Error("learning_busy");
              data = await service.verifyRecovery(command.sessionId, command.taskId, command.callId); break;
            case "task-revise":
              if (learningController) throw new Error("learning_busy");
              data = await service.reviseTask(command.sessionId, command.taskId, command.revision, command.goal); break;
            case "project-list":
              learning.registry.get(command.topicId); data = { execution: executionSupport(), projects: learning.projects.list(command.topicId), selected: learning.projects.selected(command.topicId) }; break;
            case "project-select":
              if (learningController || service.activeSessionId) throw new Error("learning_busy");
              learning.registry.get(command.topicId); learning.projects.select(command.topicId, command.projectId); data = null; break;
            case "project-create":
            case "project-import":
            case "project-view":
            case "project-read":
            case "project-preview":
            case "project-write":
            case "project-test":
            case "project-restore-preview":
            case "project-restore":
            case "project-checkpoint": {
              if (learningController || service.activeSessionId) throw new Error("learning_busy");
              learning.registry.get(command.topicId); beginLearning();
              try {
                const signal = learningController!.signal;
                if (command.type === "project-create" || command.type === "project-import") {
                  let directory: string | undefined;
                  if (command.type === "project-import") { const choice = await dialog.showOpenDialog(window, { title: "复制文本文件为独立实践项目", properties: ["openDirectory"] }); if (choice.canceled || !choice.filePaths[0]) { data = { cancelled: true }; break; } directory = choice.filePaths[0]; }
                  const project = await learning.projects.create(command.topicId, command.title, signal, directory, command.type === "project-create" ? command.language : undefined); learning.projects.select(command.topicId, project.id); data = project;
                } else if (command.type === "project-view") data = await learning.projects.snapshot(command.topicId, command.projectId, signal);
                else if (command.type === "project-read") data = await learning.projects.read(command.topicId, command.projectId, command.path);
                else if (command.type === "project-preview") data = { preview: await learning.projects.preview(command.topicId, command.projectId, command.edit) };
                else if (command.type === "project-write") data = await learning.projects.write(command.topicId, command.projectId, command.edit, signal);
                else if (command.type === "project-restore-preview") data = { preview: await learning.projects.previewRestore(command.topicId, command.projectId, command.snapshotId, command.expectedTreeHash) };
                else if (command.type === "project-restore") data = await learning.projects.restore(command.topicId, command.projectId, command.snapshotId, command.expectedTreeHash, signal);
                else if (command.type === "project-test") data = await learning.projects.test(command.topicId, command.projectId, command.expectedTreeHash, signal);
                else data = await learning.projects.checkpoint(command.topicId, command.projectId, command.expectedTreeHash, command.title, signal);
              } finally { endLearning(); }
              break;
            }
            case "mcp-settings":
              learning.registry.get(command.topicId); data = new McpSettings(learning.database).read(command.topicId); break;
            case "mcp-save":
              if (learningController || service.activeSessionId) throw new Error("learning_busy");
              learning.registry.get(command.topicId); data = new McpSettings(learning.database).replace(command.topicId, command.revision, command.servers); break;
            case "mcp-test": {
              if (learningController || service.activeSessionId) throw new Error("learning_busy");
              learning.registry.get(command.topicId);
              const server = new McpSettings(learning.database).read(command.topicId).servers.find(server => server.id === command.serverId);
              if (!server) throw new Error("mcp_settings_invalid");
              beginLearning(); let connection: McpConnection | undefined;
              try { connection = await McpConnection.open({ ...server, enabled: true }, learningController!.signal); data = { tools: connection.tools.map(tool => tool.name) }; }
              finally { await connection?.close(); endLearning(); }
              break;
            }
            case "skills-list":
              learning.registry.get(command.topicId);
              data = (await learning.skills.list(command.topicId)).map(skillMetadata);
              break;
            case "skill-read":
              learning.registry.get(command.topicId);
              data = await learning.skills.details(command.topicId, command.name);
              break;
            case "semantic-index":
              if (learningController || service.activeSessionId) throw new Error("learning_busy");
              beginLearning();
              try { data = await learning.indexSemantic(command.topicId, AbortSignal.any([learningController!.signal, AbortSignal.timeout(120_000)])); }
              finally { endLearning(); }
              break;
            case "learning-action":
              if (learningController || service.activeSessionId) throw new Error("learning_busy");
              beginLearning();
              try { data = { text: await learning.handle(command.command, command.topicId), overview: await learning.overview(command.topicId) }; }
              finally { endLearning(); }
              break;
            case "learning-cancel":
              learningController?.abort();
              data = null;
              break;
            case "learning-import": {
              if (learningController || service.activeSessionId) throw new Error("learning_busy");
              const selected = await dialog.showOpenDialog(window, { title: "导入当前主题资料", properties: ["openFile"], filters: [{ name: "学习资料", extensions: ["pdf", "md", "markdown"] }] });
              if (selected.canceled || !selected.filePaths[0]) { data = { cancelled: true }; break; }
              if (learningController || service.activeSessionId) throw new Error("learning_busy");
              beginLearning();
              try { data = await learning.importSelected(command.topicId, selected.filePaths[0], AbortSignal.any([learningController!.signal, AbortSignal.timeout(120_000)])); }
              finally { endLearning(); }
              break;
            }
            case "workspace-backup":
            case "workspace-restore": {
              if (learningController || service.activeSessionId) throw new Error("learning_busy");
              beginLearning();
              try {
                await service.pauseMaintenance();
                const restoring = command.type === "workspace-restore";
                const selected = await dialog.showOpenDialog(window, { title: restoring ? "选择知行备份文件夹" : "选择备份保存位置", properties: ["openDirectory", "createDirectory"] });
                if (selected.canceled || !selected.filePaths[0]) { data = { cancelled: true }; break; }
                const signal = learningController!.signal;
                if (!restoring) data = { path: await createWorkspaceBackup(learning, service.store, selected.filePaths[0], app.getVersion(), signal) };
                else {
                  const manifest = await inspectWorkspaceBackup(selected.filePaths[0], signal);
                  const confirmation = await dialog.showMessageBox(window, { type: "question", buttons: ["恢复为新工作区", "取消"], defaultId: 0, cancelId: 1, message: "恢复备份", detail: `来自知行 ${manifest.appVersion}，共 ${manifest.files.length} 个文件。原工作区和会话将保留，恢复的会话将使用新编号。模型密钥及当前偏好保持原样。` });
                  if (confirmation.response !== 0) { data = { cancelled: true }; break; }
                  signal.throwIfAborted();
                  const restored = await restoreWorkspaceBackup(selected.filePaths[0], path.join(service.store.root, "restored-workspaces"), service.store, signal);
                  const next = await LearningApplication.open(restored.workspace, resources);
                  try { await service.store.saveWorkspace(next.root); } catch (error) { next.close(); throw error; }
                  learning.close(); learning = next; connectService(service.store);
                  data = { ...restored, state: await boot() };
                }
              } finally { endLearning(); }
              break;
            }
            case "workspace-select": {
              if (learningController || service.activeSessionId) throw new Error("learning_busy");
              const selected = await dialog.showOpenDialog(window, { title: "连接学习工作区（选择 zhixing 项目目录或其父目录）", properties: ["openDirectory"] });
              if (selected.canceled || !selected.filePaths[0]) { data = await boot(); break; }
              if (learningController || service.activeSessionId) throw new Error("learning_busy");
              const selectedRoot = path.basename(selected.filePaths[0]) === "zhixing" ? path.dirname(selected.filePaths[0]) : selected.filePaths[0];
              await service.pauseMaintenance();
              const next = await LearningApplication.open(selectedRoot, resources);
              try { await service.store.saveWorkspace(next.root); }
              catch (error) { next.close(); throw error; }
              learning.close(); learning = next;
              connectService(service.store);
              data = await boot();
              break;
            }
            case "sessions":
              data = await service.store.page({ query: command.query, cursor: command.cursor }); break;
            case "boot":
              data = await boot();
              break;
            case "new":
              data = await service.create();
              break;
            case "load":
              data = await service.load(command.sessionId);
              break;
            case "send":
              if (learningController) throw new Error("learning_busy");
              data = await service.send(agentInput(command), false, undefined, undefined, async () => {
                deepseekModel = (await service.store.settings()).deepseekModel;
              });
              break;
            case "fork":
              data = await service.fork(command.sessionId, command.messageId, command.edit);
              break;
            case "answer":
              data = await service.answerInteraction(command.sessionId, command.itemId, command.answer, command.scope);
              break;
            case "enqueue":
              data = await service.enqueue(agentInput(command), command.steer ?? false);
              break;
            case "withdraw":
              data = await service.withdraw(command.sessionId, command.requestId);
              break;
            case "resume-queue":
              deepseekModel = (await service.store.settings()).deepseekModel;
              await service.resumeQueue(command.sessionId);
              data = null;
              break;
            case "permissions":
              data = await service.updatePermissions(command.sessionId, command.access, command.clearWriteGrants);
              break;
            case "context":
              data = await service.updateContext(command.sessionId, command.goal, command.notes);
              break;
            case "stop":
              service.stop();
              evaluationController?.abort();
              data = null;
              break;
            case "team-stop-member":
              await service.stopTeamMember(command.sessionId, command.memberId); data = null; break;
            case "rename":
              data = await service.rename(command.sessionId, command.title);
              break;
            case "settings":
              if (isCustomProvider(command.settings.provider) && !connectionProfiles.some(item => item.id === command.settings.provider)) throw new Error("provider_not_found");
              await service.store.saveSettings(command.settings);
              deepseekModel = command.settings.deepseekModel;
              semanticModel = command.settings.semanticModel ?? "";
              contextBudget = command.settings.contextBudget;
              nativeClaudeExecutable = command.settings.nativeClaudeExecutable;
              nativeCodexExecutable = command.settings.nativeCodexExecutable;
              nativeCodexModel = command.settings.nativeCodexModel;
              learning.configureSemantic(semanticModel);
              data = await boot();
              break;
            case "configure-deepseek":
              await secrets.set(
                "keychain:zhixing/deepseek-api",
                command.apiKey,
              );
              data = await boot();
              break;
            case "configure-kimi":
              await kimiSecrets.set("keychain:zhixing/kimi-api", command.apiKey);
              data = await boot();
              break;
            case "api-connection-save":
            case "api-connection-remove":
              if (service.activeSessionId || learningController) throw new Error("learning_busy");
              checkingApi = true;
              try {
                if (command.type === "api-connection-save") {
                  await apiConnections.save(command.connection, command.revision, async connection => {
                    const store = secretsFor(connection.id);
                    if (command.apiKey) await store.set(`keychain:zhixing/${connection.id}`, command.apiKey);
                    else if (!(await store.status()).configured) throw new Error("api_connections_key_required");
                  });
                } else {
                  // Keep the selected ID and historical requests. Missing connections fail
                  // explicitly until the user selects another model; no silent fallback.
                  await apiConnections.remove(command.id, command.revision);
                }
                data = await boot();
              } finally { checkingApi = false; }
              break;
            case "check-api":
              if (service.activeSessionId || learningController) throw new Error("learning_busy");
              checkingApi = true;
              try { data = await checkApiConnection(apiModel(command.provider)); }
              finally { checkingApi = false; }
              break;
            case "team-evaluation-status":
              data = { running: Boolean(evaluationController), progress: evaluationProgress }; break;
            case "team-evaluate": {
              if (service.activeSessionId || learningController || process.env.ZHIXING_ALLOW_LIVE_PROVIDER === "0") throw new Error("learning_busy");
              checkingApi = true; evaluationController = new AbortController();
              await service.pauseMaintenance();
              try {
                const evaluationRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-team-evaluation-"));
                const provenance = await learning.provenance();
                evaluationIdle = evaluateTeams({ root: evaluationRoot, suite: command.suite, leadProvider: command.leadProvider, resolve: provider => provider === "native-codex" ? nativeBackend(provider, nativeSettingsEnvironment(), contextBudget)! : provider === "pi-codex" ? createAgentModel(provider, { pi, secrets, contextBudget }) : provider === "deepseek-api" || provider === "kimi-api" ? apiModel(provider) : (() => { throw new Error("provider_not_found"); })(), signal: evaluationController.signal, onProgress: value => { evaluationProgress = value; } });
                data = { ...await evaluationIdle as object, provenance };
              } finally { checkingApi = false; evaluationController = undefined; }
              break;
            }
            case "copy":
              clipboard.writeText(command.text);
              data = null;
              break;
            case "export": {
              const session = await service.load(command.sessionId);
              const result = await dialog.showSaveDialog(window, {
                title: "导出对话",
                defaultPath: `${[...session.title]
                  .map((char) =>
                    char.charCodeAt(0) < 32 || /[<>:"/\\|?*]/.test(char)
                      ? "_"
                      : char,
                  )
                  .join("")
                  .slice(0, 60)}.md`,
                filters: [{ name: "Markdown", extensions: ["md"] }],
              });
              if (!result.canceled && result.filePath)
                await fs.writeFile(
                  result.filePath,
                  await service.exportMarkdown(session.id),
                  { mode: 0o600 },
                );
              data = { exported: !result.canceled };
              break;
            }
            case "open-link": {
              const url = new URL(command.url);
              if (
                !["https:", "http:"].includes(url.protocol) ||
                url.username ||
                url.password
              )
                throw new Error("invalid_url");
              await shell.openExternal(url.toString());
              data = null;
              break;
            }
          }
          return { ok: true, data };
        } catch (error) {
          return { ok: false, error: publicError(error) };
        }
      });
      Menu.setApplicationMenu(
        Menu.buildFromTemplate([
          ...(process.platform === "darwin"
            ? [
                {
                  label: "知行",
                  submenu: [
                    { role: "about" as const },
                    { type: "separator" as const },
                    { role: "hide" as const },
                    { role: "hideOthers" as const },
                    { type: "separator" as const },
                    { role: "quit" as const },
                  ],
                },
              ]
            : []),
          {
            label: "编辑",
            submenu: [
              { role: "undo" },
              { role: "redo" },
              { type: "separator" },
              { role: "cut" },
              { role: "copy" },
              { role: "paste" },
              { role: "selectAll" },
            ],
          },
          {
            label: "视图",
            submenu: [
              { role: "resetZoom" },
              { role: "zoomIn" },
              { role: "zoomOut" },
              { type: "separator" },
              { role: "togglefullscreen" },
            ],
          },
          { label: "窗口", submenu: [{ role: "minimize" }, { role: "close" }] },
        ]),
      );
      await createWindow();
      app.on("activate", () => {
        if (!window) void createWindow();
      });
    })
    .catch(() => {
      dialog.showErrorBox(
        "知行未能启动",
        "无法初始化本地应用，请检查磁盘空间和应用安装是否完整。",
      );
      app.exit(1);
    });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", (event) => {
    reminderScheduler?.stop();
    if (quitting) return;
    if (!service) { learning?.close(); return; }
    event.preventDefault();
    quitting = true;
    service.stop(); learningController?.abort(); evaluationController?.abort();
    void Promise.allSettled([service.idle(), learningIdle, evaluationIdle])
      .then(() => service.store.flush())
      .catch(() => console.warn("desktop_flush_unavailable"))
      .finally(() => { learning?.close(); app.quit(); });
  });
}

/** IPC envelopes are transport metadata, never part of the strict agent request. */
function agentInput<T extends { type: "send" | "enqueue"; steer?: boolean }>(command: T): Omit<T, "type" | "steer"> {
  const { type, steer, ...request } = command;
  void type; void steer;
  return request;
}
