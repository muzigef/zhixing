import { _electron as electron } from "playwright";
import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const data = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-project-ui-")); const errors = [];
let running;
async function launch() {
  const app = await electron.launch({ ...(process.env.ZHIXING_DESKTOP_EXECUTABLE ? { executablePath: process.env.ZHIXING_DESKTOP_EXECUTABLE } : {}), args: process.env.ZHIXING_DESKTOP_EXECUTABLE && !process.env.ZHIXING_DESKTOP_DEV ? [] : [root], env: { ...process.env, ZHIXING_DESKTOP_TEST_DATA: data, PI_CODING_AGENT_DIR: path.join(data, "pi-empty"), ZHIXING_ALLOW_LIVE_PROVIDER: "0", ZHIXING_DESKTOP_LIVE_CHECK: "0" }, timeout: 30_000 });
  const page = await app.firstWindow(); page.setDefaultTimeout(15_000); page.on("pageerror", error => errors.push(error.message));
  await page.getByRole("combobox", { name: "学习主题", exact: true }).selectOption("rag");
  await page.getByRole("button", { name: "课程与资料", exact: true }).click(); await page.locator(".project-panel > summary").click();
  return { app, page };
}
try {
  running = await launch(); let { page } = running;
  await page.getByRole("textbox", { name: "实践项目名称", exact: true }).fill("桌面合成实践");
  await page.getByRole("button", { name: "创建独立项目", exact: true }).click();
  await page.getByRole("button", { name: "src/implementation.mjs", exact: true }).click();
  await page.getByRole("textbox", { name: "实践文件内容", exact: true }).fill("export const solve = value => value + 1;\n");
  await page.getByRole("button", { name: "预览文件更改", exact: true }).click();
  assert.ok((await page.locator(".project-panel .interaction-card pre").innerText()).includes("+export const solve"));
  await page.getByRole("button", { name: "保存本次文件更改", exact: true }).click();
  if (["darwin", "win32"].includes(process.platform)) {
    await page.getByRole("button", { name: "运行项目测试", exact: true }).click();
    await page.locator(".project-panel").getByText("最近实际测试结果", { exact: true }).click();
    await page.locator(".project-panel").getByText(/completed · 退出码 1/).waitFor();
  } else {
    assert.equal(await page.getByRole("button", { name: "运行项目测试", exact: true }).isDisabled(), true);
    await page.locator(".project-panel").getByText(/暂无已验证的系统沙箱/).waitFor();
  }
  assert.equal(await page.getByRole("button", { name: "保存 Git 检查点", exact: true }).isDisabled(), true);
  await page.getByRole("textbox", { name: "实践文件内容", exact: true }).fill("export const solve = value => value + 0;\n");
  await page.getByRole("button", { name: "预览文件更改", exact: true }).click();
  await page.getByRole("button", { name: "保存本次文件更改", exact: true }).click();
  if (["darwin", "win32"].includes(process.platform)) {
    await page.getByRole("button", { name: "运行项目测试", exact: true }).click();
    await page.locator(".project-panel").getByText(/当前项目测试通过/).waitFor();
    await page.getByRole("button", { name: "保存 Git 检查点", exact: true }).click();
    await page.getByText("Git 检查点历史 · 2", { exact: true }).waitFor();
  } else {
    assert.equal(await page.getByRole("button", { name: "运行项目测试", exact: true }).isDisabled(), true);
    assert.equal(await page.getByRole("button", { name: "保存 Git 检查点", exact: true }).isDisabled(), true);
  }
  await page.locator(".project-snapshots > summary").click();
  await page.locator(".project-snapshots").getByRole("button", { name: "预览恢复", exact: true }).first().click();
  assert.match(await page.locator(".project-snapshots .interaction-card pre").innerText(), /value \+ 1/);
  await page.getByRole("button", { name: "恢复到这个快照", exact: true }).click();
  await page.getByRole("button", { name: "src/implementation.mjs", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "实践文件内容", exact: true }).inputValue(), "export const solve = value => value + 1;\n");
  assert.equal(await page.getByRole("button", { name: "保存 Git 检查点", exact: true }).isDisabled(), true);
  await page.locator(".project-snapshots").getByRole("button", { name: "预览恢复", exact: true }).first().click();
  await page.getByRole("button", { name: "恢复到这个快照", exact: true }).click();
  // Closing before the restore IPC settles intentionally cancels an in-flight operation.
  await page.getByRole("button", { name: "src/implementation.mjs", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "实践文件内容", exact: true }).inputValue(), "export const solve = value => value + 0;\n");
  const selected = await page.getByRole("combobox", { name: "当前实践项目", exact: true }).inputValue();
  await running.app.close(); running = await launch(); page = running.page;
  await page.getByRole("combobox", { name: "当前实践项目", exact: true }).waitFor();
  assert.equal(await page.getByRole("combobox", { name: "当前实践项目", exact: true }).inputValue(), selected);
  await page.getByRole("button", { name: "src/implementation.mjs", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "实践文件内容", exact: true }).inputValue(), "export const solve = value => value + 0;\n");
  await page.getByRole("combobox", { name: "实践项目语言", exact: true }).selectOption("python");
  await page.getByRole("textbox", { name: "实践项目名称", exact: true }).fill("Python 合成实践");
  await page.getByRole("button", { name: "创建独立项目", exact: true }).click();
  await page.getByRole("button", { name: "test_example.py", exact: true }).waitFor();
  if (["darwin", "win32"].includes(process.platform)) {
    const pythonStarted = Date.now();
    await page.getByRole("button", { name: "运行项目测试", exact: true }).click();
    // Windows stages a private Python stdlib and applies its ACL before running
    // tests. Observe the operation settling, then require a successful result;
    // an execution error must not look like a missing-success-text timeout.
    await page.locator(".project-panel").getByText("最近实际测试结果", { exact: true })
      .or(page.locator(".project-panel").getByRole("alert"))
      .waitFor({ timeout: process.platform === "win32" ? 45_000 : 15_000 });
    assert.equal(await page.locator(".project-panel").getByText(/当前项目测试通过/).isVisible(), true,
      (await page.locator(".project-panel").innerText()).slice(-3000));
    await page.locator(".project-panel").getByText("最近实际测试结果", { exact: true }).click();
    const pythonResult = await page.locator(".project-panel details").filter({ hasText: "最近实际测试结果" }).innerText();
    assert.match(pythonResult, /completed · 退出码 0/);
    assert.match(pythonResult, /Ran 1 test/);
    console.log(`Python project UI passed: ${Date.now() - pythonStarted} ms including private runtime preparation, actual unittest and cleanup.`);
  } else await page.locator(".project-panel").getByText(/当前文件尚无有效的通过记录/).waitFor();
  await page.getByRole("combobox", { name: "当前实践项目", exact: true }).selectOption("");
  await page.getByRole("button", { name: "运行项目测试", exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("combobox", { name: "学习主题", exact: true }).selectOption("tool-calling");
  await page.getByRole("button", { name: "课程与资料", exact: true }).click();
  await page.getByText("项目实践 · 0", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(`Projects UI passed: isolated multi-file Git project, exact diff, stale-test invalidation, ${["darwin", "win32"].includes(process.platform) ? "real failing/passing sandbox tests and verified Git checkpoint" : "unavailable sandbox explicitly blocks checkpoint"}, restart and topic/selection isolation.`);
} catch (error) {
  if (running) console.error((await running.page.locator("body").innerText()).slice(-5000)); throw error;
} finally { if (running) await running.app.close(); await fs.rm(data, { recursive: true, force: true }); }
