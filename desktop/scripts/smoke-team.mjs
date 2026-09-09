import { _electron as electron } from "playwright";
import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const root = path.resolve(import.meta.dirname, ".."); const data = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-team-ui-"));
let app; const errors = [];
try {
  app = await electron.launch({ ...(process.env.ZHIXING_DESKTOP_EXECUTABLE ? { executablePath: process.env.ZHIXING_DESKTOP_EXECUTABLE } : {}), args: process.env.ZHIXING_DESKTOP_EXECUTABLE && !process.env.ZHIXING_DESKTOP_DEV ? [] : [root], env: { ...process.env, ZHIXING_DESKTOP_TEST_DATA: data, ZHIXING_ALLOW_LIVE_PROVIDER: "0", ZHIXING_DESKTOP_LIVE_CHECK: "0", PI_CODING_AGENT_DIR: path.join(data, "pi-fixture") } });
  const page = await app.firstWindow(); page.setDefaultTimeout(8000); page.on("pageerror", error => errors.push(error.message));
  await page.getByRole("button", { name: "发送消息", exact: true }).waitFor();
  assert.equal(await page.getByRole("combobox", { name: "协作模式", exact: true }).inputValue(), "single");
  await app.evaluate(({ safeStorage, net }) => {
    safeStorage.isAsyncEncryptionAvailable = async () => true;
    safeStorage.encryptStringAsync = async value => Buffer.from([...value].reverse().join(""));
    safeStorage.decryptStringAsync = async value => ({ result: [...value.toString()].reverse().join("") });
    const original = net.fetch.bind(net); globalThis.teamFixtureCalls = [];
    net.fetch = async (url, options) => {
      if (/^https:\/\/api\.(?:deepseek\.com|moonshot\.cn)\/v1\/chat\/completions$/.test(String(url))) {
        const body = JSON.parse(options.body); const plan = body.messages.some(item => String(item.content).includes("TEAM_PLAN"));
        const member = body.messages.some(item => String(item.content).includes("TEAM_MEMBER"));
        globalThis.teamFixtureCalls.push({ model: body.model, member, plan });
        if (member && String(url).includes("moonshot") && globalThis.teamFixtureFail) { globalThis.teamFixtureFail = false; return new Response("", { status: 500 }); }
        const content = plan ? '{"tasks":["核查计算","查找反例"]}' : member ? "独立核查：结果为 4。" : "综合核查后，结果为 4。";
        return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: "stop" }], usage: { prompt_tokens: 100, completion_tokens: 30 } }), { headers: { "content-type": "application/json" } });
      }
      if (/^https?:/i.test(String(url))) throw new Error("unexpected_test_network"); return original(url, options);
    }; process.env.ZHIXING_ALLOW_LIVE_PROVIDER = "1";
  });
  await page.evaluate(async () => {
    for (const type of ["configure-deepseek", "configure-kimi"]) { const result = await window.zhixing.invoke({ type, apiKey: "fixture-team-ui-key" }); if (!result.ok) throw new Error(result.error); }
  });
  await page.getByRole("button", { name: "设置", exact: true }).click(); await page.getByRole("button", { name: /DeepSeek API/ }).click(); await page.getByRole("button", { name: "关闭", exact: true }).click();
  for (const mode of ["same-model-team", "mixed-model-team"]) {
    await page.getByRole("combobox", { name: "协作模式", exact: true }).selectOption(mode);
    if (mode === "mixed-model-team") {
      await page.getByRole("button", { name: "团队配置", exact: true }).click();
      await page.getByLabel("成员 1 模型连接", { exact: true }).selectOption("deepseek-api");
      await page.getByLabel("成员 2 模型连接", { exact: true }).selectOption("kimi-api");
      await page.getByRole("button", { name: "保存团队配置", exact: true }).click();
      await page.getByRole("button", { name: "保存团队配置", exact: true }).waitFor({ state: "hidden" });
    }
    await page.getByRole("textbox", { name: "发送给知行" }).fill("计算 2+2，简短回答。"); await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.locator(".assistant-message").last().getByText("综合核查后，结果为 4。", { exact: true }).waitFor();
    await page.getByRole("button", { name: "停止生成", exact: true }).waitFor({ state: "hidden" });
    const card = page.locator(".team-card").last(); await card.locator("summary").first().click();
    assert.ok((await card.innerText()).includes("2 / 2 成员已完成")); assert.ok((await card.innerText()).includes("deepseek-v4-flash"));
    if (mode === "mixed-model-team") assert.ok((await card.innerText()).includes("kimi-k3"));
  }
  await app.evaluate(() => { globalThis.teamFixtureFail = true; });
  await page.getByRole("textbox", { name: "发送给知行" }).fill("再核查一次 2+2。"); await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.locator(".team-card").last().locator("summary").first().filter({ hasText: "部分完成" }).waitFor();
  await page.getByRole("button", { name: "停止生成", exact: true }).waitFor({ state: "hidden" });
  const partial = page.locator(".team-card").last(); await partial.locator("summary").first().click();
  assert.ok((await partial.innerText()).includes("1 / 2 成员已完成"));
  await page.getByRole("button", { name: "重新运行整个团队（新任务）", exact: true }).click();
  await page.locator(".team-card").last().locator("summary").first().filter({ hasText: "已完成" }).waitFor();
  await page.getByRole("button", { name: "停止生成", exact: true }).waitFor({ state: "hidden" });
  const calls = await app.evaluate(() => globalThis.teamFixtureCalls); assert.equal(calls.length, 16); assert.equal(calls.filter(item => item.member).length, 8);
  assert.deepEqual(errors, []); await page.screenshot({ path: path.join(os.tmpdir(), "zhixing-team-ui.png"), animations: "disabled" });
  console.log("Team UI passed: default single, same/mixed selection, provider configuration, real application scheduling with isolated mocked HTTP, persisted member state, actual model labels, partial failure and explicit fresh-team rerun.");
} catch (error) {
  if (app) {
    const page = await app.firstWindow();
    console.error("Team UI failure state:", await page.evaluate(async () => ({
      draft: document.querySelector("textarea")?.value,
      text: document.body.innerText,
      boot: await window.zhixing.invoke({ type: "boot" }),
    })));
  }
  throw error;
} finally { if (app) await app.close(); await fs.rm(data, { recursive: true, force: true }); }
