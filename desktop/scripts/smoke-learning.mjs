import { _electron as electron } from "playwright";
import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const data = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-learning-ui-"));
const fixture = path.join(data, "learning-fixture.md");
await fs.writeFile(fixture, "# 检索证据\n\n可验证的学习回答应关联原文出处，不能把用户声明当成测试通过。");
const errors = [];
let running;
async function launch() {
  const app = await electron.launch({
    ...(process.env.ZHIXING_DESKTOP_EXECUTABLE ? { executablePath: process.env.ZHIXING_DESKTOP_EXECUTABLE } : {}),
    args: process.env.ZHIXING_DESKTOP_EXECUTABLE && !process.env.ZHIXING_DESKTOP_DEV ? [] : [root],
    env: { ...process.env, ZHIXING_DESKTOP_TEST_DATA: data, PI_CODING_AGENT_DIR: path.join(data, "pi-empty"), ZHIXING_ALLOW_LIVE_PROVIDER: "0", ZHIXING_DESKTOP_LIVE_CHECK: "0" },
    timeout: 30_000,
  });
  const page = await app.firstWindow(); page.setDefaultTimeout(15_000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.getByRole("combobox", { name: "学习主题", exact: true }).waitFor();
  return { app, page };
}
try {
  running = await launch(); let { page } = running;
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "离线演示 无需联网，体验界面与交互" }).click();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("combobox", { name: "学习主题", exact: true }).selectOption("agent-development");
  await page.getByRole("checkbox", { name: /本会话使用学习上下文/ }).check();
  await page.getByRole("button", { name: "课程与资料", exact: true }).click();
  await page.getByRole("button", { name: "开始学习", exact: true }).first().click();
  await page.locator(".course-row").first().getByText(/进行中/).waitFor();
  await running.app.evaluate(({ dialog }, selected) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
  }, fixture);
  await page.getByRole("button", { name: "导入 PDF / Markdown", exact: true }).click();
  await page.locator(".material-list").getByText("learning-fixture.md", { exact: true }).waitFor();
  await running.app.evaluate(({ dialog }, selected) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] }); }, path.join(root, "../tests/fixtures/documents/text.pdf"));
  await page.getByRole("button", { name: "导入 PDF / Markdown", exact: true }).click();
  await page.locator(".material-list").getByText("text.pdf", { exact: true }).waitFor();
  for (const [kind, content] of Object.entries({ implementation: "export const add = (a, b) => a + b;", testOutput: "用户报告：输入 1 和 2，观察到结果 3。", failureCase: "输入字符串时发生连接，后续需要验证类型。", reflection: "我学会了区分已提交报告和应用复跑结果。", testScript: "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {add} from './implementation.mjs'; test('addition',()=>assert.equal(add(1,2),3));" })) {
    await page.getByRole("combobox", { name: "证据类型", exact: true }).selectOption(kind);
    await page.getByRole("textbox", { name: "证据内容", exact: true }).fill(content);
    await page.getByRole("button", { name: "保存证据", exact: true }).click();
    await page.getByText("已保存实际产物及内容哈希。", { exact: true }).waitFor();
  }
  await page.getByRole("button", { name: "检查完成证据", exact: true }).click();
  await page.locator(".evidence-result").getByText(/未复跑/).waitFor();
  await page.getByText("运行本地 JavaScript 测试", { exact: true }).click();
  await page.getByRole("button", { name: "运行提交的测试", exact: true }).click();
  await page.locator(".evidence-result").getByText(process.platform === "darwin" ? /退出码 0/ : /unavailable/).waitFor();
  await page.locator(".course-row").first().getByText(/完成/).waitFor();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("textbox", { name: "发送给知行" }).fill("请根据资料解释可验证的检索证据。");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.locator(".source-list button").first().waitFor();
  await page.getByRole("button", { name: "停止生成", exact: true }).waitFor({ state: "hidden" });
  await page.locator(".source-list button").first().click();
  await page.getByText("不能把用户声明当成测试通过。", { exact: false }).waitFor();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("textbox", { name: "发送给知行" }).fill("继续讲解检索");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.getByRole("button", { name: "停止生成", exact: true }).waitFor();
  await page.getByRole("textbox", { name: "发送给知行" }).fill("待办：补充数据库例子");
  await page.getByRole("button", { name: "排队", exact: true }).click();
  await page.getByLabel("待发送消息", { exact: true }).getByText("待办：补充数据库例子", { exact: true }).waitFor();
  await page.getByRole("button", { name: "停止生成", exact: true }).click();
  await page.getByRole("button", { name: "停止生成", exact: true }).waitFor({ state: "hidden" });
  const captures = path.join(os.tmpdir(), "zhixing-desktop-preview"); await fs.mkdir(captures, { recursive: true });
  await page.screenshot({ path: path.join(captures, "learning-conversation.png"), animations: "disabled" });
  await running.app.close(); running = await launch(); page = running.page;
  await page.getByRole("button", { name: "继续待办", exact: true }).waitFor();
  await page.getByRole("button", { name: "继续待办", exact: true }).click();
  await page.getByLabel("待发送消息", { exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "停止生成", exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "会话选项", exact: true }).click();
  await page.getByRole("button", { name: "任务目标与约束", exact: true }).click();
  await page.getByRole("textbox", { name: "任务目标", exact: true }).fill("理解检索并保留证据来源");
  await page.getByRole("textbox", { name: "明确约束与偏好", exact: true }).fill("中文，先结论后例子");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByRole("textbox", { name: "任务目标", exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("textbox", { name: "发送给知行" }).fill("再解释一次");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.getByRole("button", { name: "停止生成", exact: true }).waitFor();
  await page.getByRole("textbox", { name: "发送给知行" }).fill("纠正：改用数据库例子");
  await page.getByRole("button", { name: "立即调整", exact: true }).click();
  await page.locator(".user-message").getByText("纠正：改用数据库例子", { exact: true }).waitFor();
  await page.getByRole("button", { name: "停止生成", exact: true }).waitFor({ state: "hidden" });
  await page.locator(".source-list button").first().waitFor();
  assert.equal(await page.getByRole("combobox", { name: "学习主题", exact: true }).inputValue(), "agent-development");
  assert.equal(await page.getByRole("checkbox", { name: /本会话使用学习上下文/ }).isChecked(), true);
  await page.getByRole("button", { name: "课程与资料", exact: true }).click();
  await page.locator(".course-row").first().getByText(/完成/).waitFor();
  await page.screenshot({ path: path.join(captures, "learning-workspace.png"), animations: "disabled" });
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("combobox", { name: "学习主题", exact: true }).selectOption("tool-calling");
  assert.equal(await page.locator(".assistant-message").count(), 0);
  await page.getByRole("button", { name: "课程与资料", exact: true }).click();
  assert.equal(await page.locator(".material-list li").count(), 0);
  assert.deepEqual(errors, []);
  console.log("Learning UI passed: shared course/progress, native import, conversation consent, source navigation, evidence review, actual local tests, queue/steer/stop/resume, persistent goals, restart and topic isolation.");
} catch (error) {
  if (running) {
    await running.page.screenshot({ path: path.join(os.tmpdir(), "zhixing-learning-failure.png") });
    console.error("UI failure state", await running.page.getByRole("textbox", { name: "发送给知行" }).inputValue(), await running.page.getByRole("button", { name: "停止生成", exact: true }).count());
  }
  throw error;
} finally {
  if (running) await running.app.close();
  await fs.rm(data, { recursive: true, force: true });
}
