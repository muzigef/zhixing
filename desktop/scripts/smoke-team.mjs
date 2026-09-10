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
        const review = body.messages.some(item => item.role === "system" && String(item.content).includes("TEAM_REVIEW"));
        const followup = body.messages.some(item => item.role === "system" && String(item.content).includes("TEAM_FOLLOWUP"));
        globalThis.teamFixtureCalls.push({ model: body.model, member, plan, followup });
        if (member && String(url).includes("moonshot") && globalThis.teamFixtureFail) { globalThis.teamFixtureFail = false; return new Response("", { status: 500 }); }
        const conflict = Boolean(globalThis.teamFixtureConflict);
        const content = plan ? '{"tasks":["核查计算","查找反例"]}' : member || followup ? JSON.stringify({ summary: "独立核查结论。", claims: [{ key: "answer", value: member && conflict && String(url).includes("moonshot") ? "5" : "4", basis: "逐项计算并核对原条件。" }], uncertainties: [] }) : review ? JSON.stringify({ verdict: conflict ? "needs-check" : "ready", issues: conflict ? ["两个候选结果不一致"] : [], guidance: "逐项检查最终答案。", followUp: conflict ? { member: 2, question: "重新计算，说明两个候选结果的差异。" } : null }) : "综合核查后，结果为 4。";
        if (review) globalThis.teamFixtureConflict = false;
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
      await page.getByLabel("成员 2 思考程度", { exact: true }).selectOption("quick");
      await page.getByLabel("团队成员时限", { exact: true }).selectOption("180000");
      await page.getByRole("button", { name: "保存团队配置", exact: true }).click();
      await page.getByRole("button", { name: "保存团队配置", exact: true }).waitFor({ state: "hidden" });
      await app.evaluate(() => { globalThis.teamFixtureConflict = true; });
    }
    await page.getByRole("textbox", { name: "发送给知行" }).fill("计算 2+2，简短回答。"); await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.locator(".assistant-message").last().getByText("综合核查后，结果为 4。", { exact: true }).waitFor();
    await page.getByRole("button", { name: "停止生成", exact: true }).waitFor({ state: "hidden" });
    const card = page.locator(".team-card").last(); await card.locator("summary").first().click();
    assert.ok((await card.innerText()).includes("2 / 2 成员已完成")); assert.ok((await card.innerText()).includes("deepseek-v4-flash"));
    assert.ok((await card.innerText()).includes("已返回审查意见"));
    assert.ok((await card.innerText()).includes("任务与依赖")); assert.ok((await card.innerText()).includes("待核查"));
    if (mode === "mixed-model-team") { assert.ok((await card.innerText()).includes("kimi-k3")); await card.getByText("查看定向复核 · 已返回结果", { exact: true }).click(); assert.ok((await card.innerText()).includes("重新计算，说明两个候选结果的差异。")); }
  }
  await app.evaluate(() => { globalThis.teamFixtureFail = true; });
  await page.getByRole("textbox", { name: "发送给知行" }).fill("再核查一次 2+2。"); await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.locator(".team-card").last().locator("summary").first().filter({ hasText: "部分完成" }).waitFor();
  await page.getByRole("button", { name: "停止生成", exact: true }).waitFor({ state: "hidden" });
  const partial = page.locator(".team-card").last(); await partial.locator("summary").first().click();
  assert.ok((await partial.innerText()).includes("1 / 2 成员已完成"));
  const beforeRetry = await app.evaluate(() => globalThis.teamFixtureCalls.length);
  await partial.locator(".team-tasks details:has(button) > summary").click();
  await partial.getByRole("button", { name: "补做此任务", exact: true }).click();
  await page.getByRole("button", { name: "停止生成", exact: true }).waitFor({ state: "hidden" });
  await page.locator(".team-card").last().locator("summary").first().filter({ hasText: "已完成" }).waitFor();
  const retryCalls = await app.evaluate((_electron, offset) => globalThis.teamFixtureCalls.slice(offset), beforeRetry);
  assert.equal(retryCalls.length, 3); assert.equal(retryCalls.filter(call => call.member).length, 1); assert.equal(retryCalls.filter(call => call.plan).length, 0);
  await page.getByRole("button", { name: "重新运行整个团队（新任务）", exact: true }).click();
  await page.locator(".team-card").last().locator("summary").first().filter({ hasText: "已完成" }).waitFor();
  await page.getByRole("button", { name: "停止生成", exact: true }).waitFor({ state: "hidden" });
  const calls = await app.evaluate(() => globalThis.teamFixtureCalls); assert.equal(calls.length, 25); assert.equal(calls.filter(item => item.member).length, 9); assert.equal(calls.filter(item => item.followup).length, 1);
  assert.deepEqual(errors, []); await page.screenshot({ path: path.join(os.tmpdir(), "zhixing-team-ui.png"), animations: "disabled" });
  await app.evaluate(() => {
    const files = process.getBuiltinModule("node:fs/promises"); const open = files.open.bind(files);
    files.open = async (file, ...args) => { if (String(file).endsWith("preferences.json")) await new Promise(resolve => setTimeout(resolve, 600)); return open(file, ...args); };
  });
  const stoppedSession = await page.evaluate(async () => {
    const created = await window.zhixing.invoke({ type: "new" }); if (!created.ok) throw new Error("fixture_create_failed");
    const sending = window.zhixing.invoke({ type: "send", sessionId: created.data.id, provider: "demo", style: "adaptive", text: "合成停止测试", collaboration: { mode: "single" } });
    await window.zhixing.invoke({ type: "stop" }); await sending; return created.data.id;
  });
  await page.waitForFunction(async id => { const loaded = await window.zhixing.invoke({ type: "load", sessionId: id }); return loaded.ok && loaded.data.messages.at(-1)?.status === "interrupted"; }, stoppedSession, { timeout: 10_000 });
  console.log("Team UI passed: default single, same/mixed selection, provider configuration, real application scheduling with isolated mocked HTTP, persisted member state, actual model labels, partial failure, criterion coverage, targeted retry (3 requests, no peer replay) and explicit fresh-team rerun.");
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
