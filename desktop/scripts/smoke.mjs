import { _electron as electron } from "playwright";
import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const data = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-desktop-ui-"));
const captures = path.join(os.tmpdir(), "zhixing-desktop-preview");
await fs.mkdir(captures, { recursive: true });
const piDir = path.join(data, "pi-fixture");
await fs.mkdir(piDir);
await fs.writeFile(
  path.join(piDir, "settings.json"),
  JSON.stringify({
    defaultProvider: "openai-codex",
    defaultModel: "fixture-codex",
    defaultThinkingLevel: "medium",
  }),
);
const errors = [];
async function launch() {
  const app = await electron.launch({
    ...(process.env.ZHIXING_DESKTOP_EXECUTABLE
      ? { executablePath: process.env.ZHIXING_DESKTOP_EXECUTABLE }
      : {}),
    args:
      process.env.ZHIXING_DESKTOP_EXECUTABLE && !process.env.ZHIXING_DESKTOP_DEV
        ? []
        : [root],
    env: {
      ...process.env,
      ZHIXING_DESKTOP_TEST_DATA: data,
      PI_CODING_AGENT_DIR: piDir,
      ZHIXING_ALLOW_LIVE_PROVIDER: "0",
      ZHIXING_DESKTOP_LIVE_CHECK: "0",
    },
    timeout: 30_000,
  });
  const page = await app.firstWindow({ timeout: 20_000 });
  page.setDefaultTimeout(12_000);
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.getByRole("button", { name: "发送消息", exact: true }).waitFor();
  } catch (error) {
    await app.close();
    throw error;
  }
  return { app, page };
}
let running;
try {
  running = await launch();
  let { page } = running;
  await page.getByText("今天，想探索些什么？", { exact: true }).waitFor();
  await page.screenshot({
    animations: "disabled",
    path: path.join(captures, "01-welcome.png"),
  });
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  const piVersion = await running.app.evaluate(async ({ app }) => {
    const { execFile } = process.getBuiltinModule("node:child_process");
    const { promisify } = process.getBuiltinModule("node:util");
    const { join } = process.getBuiltinModule("node:path");
    const { readFile } = process.getBuiltinModule("node:fs/promises");
    const piPackage = join(
      app.getAppPath().replace(/app\.asar$/, "app.asar.unpacked"),
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
    );
    const metadata = JSON.parse(await readFile(join(piPackage, "package.json"), "utf8"));
    const cli = join(piPackage, metadata.bin.pi);
    const result = await promisify(execFile)(
      process.execPath,
      [cli, "--version"],
      {
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          PATH: "",
          PI_OFFLINE: "1",
          PI_SKIP_VERSION_CHECK: "1",
        },
        timeout: 20_000,
      },
    );
    return result.stdout.trim();
  });
  const desktopPackage = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(piVersion, desktopPackage.dependencies["@earendil-works/pi-coding-agent"]);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("button", { name: "离线演示 无需联网，体验界面与交互" })
    .click();
  await page
    .getByRole("combobox", { name: "外观", exact: true })
    .selectOption("light");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.locator(".model-picker").filter({ hasText: "离线演示" }).waitFor();
  await page.getByRole("combobox", { name: "思考强度", exact: true }).selectOption("auto");
  await page
    .getByRole("textbox", { name: "发送给知行" })
    .fill("请用两段直观例子解释梯度下降，并展示公式和代码。");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.getByRole("button", { name: "停止生成", exact: true }).waitFor();
  await page.locator(".katex-display").waitFor();
  await page
    .getByRole("button", { name: "停止生成", exact: true })
    .waitFor({ state: "hidden" });
  assert.equal(await page.locator(".assistant-message").count(), 1);
  await page.getByText("回答检查提示", { exact: true }).click();
  await page.getByText("以下是格式和来源提示，内容正确性仍需核对。", { exact: true }).waitFor();
  await page.getByText("回答检查提示", { exact: true }).click();
  await page.getByText("本轮自动选择：深入思考", { exact: true }).waitFor();
  await page.getByRole("combobox", { name: "思考强度", exact: true }).selectOption("balanced");
  await page.getByText("本轮上下文范围", { exact: true }).click();
  assert.ok((await page.locator(".assistant-message").innerText()).includes("不作为计费用量"));
  await page.getByText("本轮上下文范围", { exact: true }).click();
  assert.ok(
    (await page.locator(".assistant-message").innerText()).includes("离线演示"),
  );
  await page.screenshot({
    animations: "disabled",
    path: path.join(captures, "02-conversation.png"),
  });
  await page.getByRole("button", { name: "复制回答", exact: true }).click();
  assert.ok(
    (
      await running.app.evaluate(({ clipboard }) => clipboard.readText())
    ).includes("离线演示"),
  );
  await page
    .getByRole("textbox", { name: "发送给知行" })
    .fill("让我再看一个例子");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.getByRole("button", { name: "停止生成", exact: true }).click();
  await page.getByRole("button", { name: "继续回答", exact: true }).waitFor();
  await page.getByRole("button", { name: "会话选项", exact: true }).click();
  await page.getByRole("button", { name: "重命名对话", exact: true }).click();
  await page
    .getByRole("textbox", { name: "对话名称" })
    .fill("梯度下降 · 学习记录");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const exportedFile = path.join(data, "exported.md");
  await running.app.evaluate(({ dialog }, exportedFile) => {
    dialog.showSaveDialog = async () => ({
      canceled: false,
      filePath: exportedFile,
    });
  }, exportedFile);
  await page.getByRole("button", { name: "会话选项", exact: true }).click();
  await page
    .getByRole("button", { name: "导出 Markdown", exact: true })
    .click();
  await page.getByText("已导出为 Markdown", { exact: true }).waitFor();
  assert.ok(
    (await fs.readFile(exportedFile, "utf8")).includes("# 梯度下降 · 学习记录"),
  );
  await page
    .getByRole("textbox", { name: "发送给知行" })
    .fill("下次继续讨论学习率");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("combobox", { name: "外观", exact: true })
    .selectOption("dark");
  await page.screenshot({
    animations: "disabled",
    path: path.join(captures, "03-settings-dark.png"),
  });
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await running.app.close();
  running = undefined;
  running = await launch();
  page = running.page;
  await page
    .getByText("梯度下降 · 学习记录", { exact: true })
    .first()
    .waitFor();
  assert.equal(await page.locator(".assistant-message").count(), 2);
  assert.equal(
    await page.getByRole("textbox", { name: "发送给知行" }).inputValue(),
    "下次继续讨论学习率",
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.dataset.theme),
    "dark",
  );
  await page.getByRole("textbox", { name: "搜索对话" }).fill("没有的标题");
  await page.getByText("没有找到相关对话", { exact: true }).waitFor();
  await page.getByRole("button", { name: "新对话" }).click();
  assert.equal(await page.locator(".assistant-message").count(), 0);
  await running.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(780, 620),
  );
  await page.screenshot({
    animations: "disabled",
    path: path.join(captures, "04-compact.png"),
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  const input = page.getByRole("textbox", { name: "发送给知行" });
  await input.fill("中文输入法候选确认");
  await input.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 229,
    isComposing: true,
    bubbles: true,
  });
  assert.equal(await page.locator(".user-message").count(), 0);
  await input.press("End");
  await input.press("Shift+Enter");
  assert.ok((await input.inputValue()).includes("\n"));
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("button", { name: "Pi · Codex 沿用 Pi 的模型配置与登录" })
    .click();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await input.fill("检查切换行为，不发送到真实模型");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page
    .getByRole("button", { name: "切换到 DeepSeek 重试", exact: true })
    .click();
  await page.locator(".model-picker").filter({ hasText: "DeepSeek" }).waitFor();
  // The model selector updates before the asynchronous retry appends its response.
  await page.locator(".assistant-message").nth(1)
    .getByText("当前已禁用联网模型。可以在设置中切换到离线演示。", { exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "停止生成", exact: true })
    .waitFor({ state: "hidden" });
  assert.equal(await page.locator(".assistant-message").count(), 2);
  assert.ok(
    (
      await page.locator(".assistant-message .demo-badge").allTextContents()
    ).includes("DeepSeek API"),
  );
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page
    .getByRole("combobox", { name: "DeepSeek 模型", exact: true })
    .selectOption("deepseek-v4-pro");
  await running.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1260, 840),
  );
  await page.screenshot({
    animations: "disabled",
    path: path.join(captures, "05-deepseek-settings.png"),
  });
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await running.app.close();
  running = undefined;
  running = await launch();
  page = running.page;
  await page
    .locator(".model-picker")
    .filter({ hasText: "DeepSeek · v4-pro" })
    .waitFor();
  // Real IPC/rendering burst in a disposable session; no production test hook.
  const current = await page.evaluate(async () => {
    const response = await window.zhixing.invoke({ type: "load", sessionId: localStorage.getItem("last-session") });
    if (!response.ok) throw new Error(response.error);
    return response.data;
  });
  const burstText = "流".repeat(1000) + "尾段";
  current.messages.at(-1).text = "";
  current.messages.at(-1).status = "running";
  const burstStart = Date.now();
  await running.app.evaluate(({ BrowserWindow }, session) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    contents.send("zhixing:event", { type: "session", session });
    for (let i = 0; i < 1000; i++) contents.send("zhixing:event", { type: "delta", sessionId: session.id, messageId: session.messages.at(-1).id, text: "流" });
    contents.send("zhixing:event", { type: "delta", sessionId: session.id, messageId: session.messages.at(-1).id, text: "尾段" });
    contents.send("zhixing:event", { type: "settled", sessionId: session.id });
  }, current);
  await page.waitForFunction(expected => [...document.querySelectorAll(".assistant-message .markdown")].at(-1)?.textContent === expected, burstText);
  current.messages.at(-1).text = burstText;
  current.messages.at(-1).status = "completed";
  await running.app.evaluate(({ BrowserWindow }, session) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents;
    contents.send("zhixing:event", { type: "delta", sessionId: session.id, messageId: session.messages.at(-1).id, text: "应被快照覆盖" });
    contents.send("zhixing:event", { type: "session", session });
    contents.send("zhixing:event", { type: "delta", sessionId: "other-session", messageId: session.messages.at(-1).id, text: "不可串入" });
    contents.send("zhixing:event", { type: "settled", sessionId: session.id });
  }, current);
  await page.getByRole("button", { name: "复制回答", exact: true }).last().click();
  assert.equal(await running.app.evaluate(({ clipboard }) => clipboard.readText()), burstText);
  console.log(`Renderer burst passed: 1001 IPC deltas, exact final/copy text, snapshot precedence and session isolation; ${Date.now() - burstStart} ms including UI assertions.`);
  assert.deepEqual(errors, []);
  console.log(
    "Desktop UI passed: sandbox bridge, bundled Pi, streaming, math, copy, export, stop, rename, history, drafts, search, theme, IME, Pi-to-DeepSeek retry and persisted API model.",
  );
  console.log(`Screenshots: ${captures}`);
} catch (error) {
  if (running) {
    await running.page.screenshot({
      path: path.join(captures, "failure.png"),
      animations: "disabled",
    });
    console.error(
      (await running.page.locator("body").innerText()).slice(0, 3500),
    );
  }
  throw error;
} finally {
  if (running) await running.app.close();
  await fs.rm(data, { recursive: true, force: true });
}
