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
import { PiCodexClient } from "../../src/pi-client.js";
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
import { packagedPiRunner } from "../core/pi-runner.js";

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
let pi: PiCodexClient;
let secrets: EncryptedDesktopSecrets;
let deepseekModel = "deepseek-v4-flash";
let quitting = false;

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
      const piCli = path.join(
        app.getAppPath().replace(/app\.asar$/, "app.asar.unpacked"),
        "node_modules",
        "@earendil-works",
        "pi-coding-agent",
        "dist",
        "cli.js",
      );
      pi = new PiCodexClient({
        projectDir: runtime,
        runner: packagedPiRunner(
          process.execPath,
          piCli,
          path.join(resources, "zhixing-guard.mjs"),
        ),
      });
      secrets = desktopSecrets(root);
      service = new DesktopService(new DesktopStore(root), (provider) =>
        provider === "demo"
          ? new DesktopDemoClient()
          : provider === "deepseek-api"
            ? new DeepSeekClient(
                secrets,
                (url, options) => net.fetch(url, options),
                process.env,
                deepseekModel,
              )
            : pi,
      );
      service.subscribe((event) => {
        if (window && !window.isDestroyed())
          window.webContents.send("zhixing:event", event);
      });
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
          let data: unknown;
          switch (command.type) {
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
              deepseekModel = (await service.store.settings()).deepseekModel;
              data = await service.send(command);
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
    if (quitting || !service?.activeSessionId) return;
    event.preventDefault();
    quitting = true;
    service.stop();
    void service.idle().finally(() => app.quit());
  });
}
