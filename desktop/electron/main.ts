import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  shell,
} from "electron";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DeepSeekClient } from "../../src/deepseek-client.js";
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
import { summarizePerformance } from "../core/diagnostics.js";
import { checkRelease } from "../core/updates.js";

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
let deepseekModel = "deepseek-v4-flash";
let semanticModel = "";
let quitting = false;
let learning: LearningApplication;
let learningController: AbortController | undefined;
let learningIdle: Promise<void> = Promise.resolve();
let finishLearning: (() => void) | undefined;
function beginLearning(): void { learningController = new AbortController(); learningIdle = new Promise<void>((resolve) => { finishLearning = resolve; }); }
function endLearning(): void { learningController = undefined; finishLearning?.(); finishLearning = undefined; }

function connectService(store: DesktopStore): void {
  learning.configureSemantic(semanticModel);
  service = new DesktopService(store, (provider) => provider === "demo" ? new DesktopDemoClient() : provider === "deepseek-api"
    ? new DeepSeekClient(secrets, (url, options) => net.fetch(url, options), process.env, deepseekModel) : pi, learning);
  service.subscribe((event) => { if (window && !window.isDestroyed()) window.webContents.send("zhixing:event", event); });
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
async function boot(): Promise<BootState> {
  const settings = await service.store.settings();
  let status: { configured: boolean; source?: "desktop" | "system-keychain" };
  try {
    status = await secrets.status();
  } catch {
    status = { configured: false };
  }
  return {
    workspace: learning.summary(),
    sessions: await service.store.list(),
    settings,
    model: await modelStatus(),
    activeSessionId: service.activeSessionId,
    api: {
      ...status,
      model: settings.deepseekModel,
      message: status.configured
        ? status.source === "system-keychain"
          ? "已找到现有知行 API 配置，可直接使用。有效性将在发送时检查。"
          : "API Key 已由系统加密保存。有效性将在发送时检查。"
        : "未找到现有 DeepSeek 配置，可在下方添加 API Key。",
    },
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
      const store = new DesktopStore(root);
      deepseekModel = (await store.settings()).deepseekModel;
      semanticModel = (await store.settings()).semanticModel ?? "";
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
          if (learningController && ["new", "fork", "answer", "enqueue", "resume-queue", "withdraw", "context", "rename", "settings", "configure-deepseek", "workspace-select", "workspace-backup", "workspace-restore"].includes(command.type)) throw new Error("learning_busy");
          let data: unknown;
          switch (command.type) {
            case "diagnostics": {
              const sessions = await service.store.list();
              const recent = await Promise.all(sessions.slice(0, 20).map((session) => service.load(session.id)));
              data = { version: app.getVersion(), performance: summarizePerformance(recent.flatMap((session) => session.messages).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(-200)) };
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
            case "assessment-submit":
              if (learningController || service.activeSessionId) throw new Error("learning_busy");
              data = await learning.submitAssessment(command.topicId, command.dayId, command.attemptId, command.answers, command.reflection);
              break;
            case "learning-source":
              data = await learning.source(command.topicId, command.citation);
              break;
            case "skills-list":
              learning.registry.get(command.topicId);
              data = (await learning.skills.list(command.topicId)).map(({ name, description, scope }) => ({ name, description, scope }));
              break;
            case "skill-read":
              learning.registry.get(command.topicId);
              data = await learning.skills.read(command.topicId, command.name);
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
              deepseekModel = (await service.store.settings()).deepseekModel;
              data = await service.send(command);
              break;
            case "fork":
              data = await service.fork(command.sessionId, command.messageId, command.edit);
              break;
            case "answer":
              data = await service.answerInteraction(command.sessionId, command.itemId, command.answer, command.scope);
              break;
            case "enqueue":
              data = await service.enqueue(command, command.steer ?? false);
              break;
            case "withdraw":
              data = await service.withdraw(command.sessionId, command.requestId);
              break;
            case "resume-queue":
              deepseekModel = (await service.store.settings()).deepseekModel;
              await service.resumeQueue(command.sessionId);
              data = null;
              break;
            case "context":
              data = await service.updateContext(command.sessionId, command.goal, command.notes);
              break;
            case "stop":
              service.stop();
              data = null;
              break;
            case "rename":
              data = await service.rename(command.sessionId, command.title);
              break;
            case "settings":
              await service.store.saveSettings(command.settings);
              deepseekModel = command.settings.deepseekModel;
              semanticModel = command.settings.semanticModel ?? "";
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
    if (quitting) return;
    if (!service?.activeSessionId && !learningController) { learning?.close(); return; }
    event.preventDefault();
    quitting = true;
    service.stop(); learningController?.abort();
    void Promise.allSettled([service.idle(), learningIdle]).finally(() => { learning?.close(); app.quit(); });
  });
}
