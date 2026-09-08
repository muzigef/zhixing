import { _electron as electron } from "playwright";
import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
// Only synthetic pixels and prompts leave the temporary workspace. Credentials
// remain inside the application's normal SecretStore/provider boundary.
if (!process.argv.includes("--live")) throw new Error("Pass --live for this bounded, real DeepSeek image check.");
const root = path.resolve(import.meta.dirname, "..");
const data = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-vision-"));
const app = await electron.launch({ args: [root], env: { ...process.env, ZHIXING_DESKTOP_TEST_DATA: data, ZHIXING_DESKTOP_LIVE_CHECK: "1", PI_CODING_AGENT_DIR: path.join(data, "pi"), ZHIXING_ALLOW_LIVE_PROVIDER: "1" }, timeout: 30_000 });
const report = { model: "deepseek-v4-flash-vision-exp", synthetic: true, turns: [] };
try {
  const page = await app.firstWindow(); page.setDefaultTimeout(180_000);
  await page.getByRole("button", { name: "发送消息", exact: true }).waitFor();
  const state = await page.evaluate(async () => (await window.zhixing.invoke({ type: "boot" })).data);
  assert.equal(state.api.configured, true, "Existing API configuration is required");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: /DeepSeek API/ }).click();
  await page.getByLabel("DeepSeek 模型", { exact: true }).selectOption(report.model);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByLabel("思考强度", { exact: true }).selectOption("quick");
  const bytes = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 640; canvas.height = 360;
    const ctx = canvas.getContext("2d"); ctx.fillStyle = "white"; ctx.fillRect(0, 0, 640, 360);
    for (const [index, color] of ["#d82828", "#1455ca", "#26942b"].entries()) {
      ctx.fillStyle = color; ctx.fillRect(60 + index * 190, 70, 130, 180);
      ctx.fillStyle = "black"; ctx.font = "32px sans-serif"; ctx.fillText(String([17, 42, 63][index]), 102 + index * 190, 300);
    }
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.getByLabel("添加图片", { exact: true }).setInputFiles({ name: "synthetic-chart.png", mimeType: "image/png", buffer: Buffer.from(bytes, "base64") });
  await page.getByAltText("待发送图片：synthetic-chart.png", { exact: true }).waitFor();
  async function send(text) {
    const before = await page.locator(".assistant-message").count();
    await page.getByRole("textbox", { name: "发送给知行", exact: true }).fill(text);
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.waitForFunction(n => document.querySelectorAll(".assistant-message").length > n, before);
    await page.getByRole("button", { name: "停止生成", exact: true }).waitFor({ state: "hidden" });
    const result = await page.evaluate(async () => {
      const boot = await window.zhixing.invoke({ type: "boot" });
      const session = await window.zhixing.invoke({ type: "load", sessionId: boot.data.sessions[0].id });
      const m = session.data.messages.at(-1);
      return { status: m.status, text: m.text, error: m.error, durationMs: m.durationMs, firstTokenMs: m.firstTokenMs, model: m.model };
    });
    report.turns.push(result); assert.equal(result.status, "completed", result.error);
    return result.text;
  }
  const answer = await send("按图片从左到右依次写出每个色块的颜色及其下方数字；不需要解释。");
  for (const pattern of [/红[\s\S]*17/, /蓝[\s\S]*42/, /绿[\s\S]*63/]) assert.match(answer, pattern);
  assert.equal(await page.locator(".sent-images img").count(), 1);
  await page.reload(); await page.getByRole("button", { name: "发送消息", exact: true }).waitFor();
  assert.equal(await page.locator(".sent-images img").count(), 1);
  assert.match(await send("再次查看刚才的图片，中间色块是什么颜色、数字是多少？只回答这两项。"), /蓝[\s\S]*42/);
  const exportedFile = path.join(data, "exported.md");
  await app.evaluate(({ dialog }, filePath) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath }); }, exportedFile);
  await page.getByRole("button", { name: "会话选项", exact: true }).click();
  await page.getByRole("button", { name: "导出 Markdown", exact: true }).click();
  await page.getByText("已导出为 Markdown", { exact: true }).waitFor();
  assert.ok((await fs.readFile(exportedFile, "utf8")).includes(`data:image/png;base64,${bytes}`));
  report.checks = ["real visual ground truth", "UI attach and send", "persist and reload", "follow-up retains pixels", "export retains pixels"];
  report.status = "passed";
} catch (error) { report.status = "failed"; report.error = String(error); process.exitCode = 1; }
finally { await app.close(); await fs.rm(data, { recursive: true, force: true }); console.log(JSON.stringify(report, null, 2)); }
