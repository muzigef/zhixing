import { _electron as electron } from "playwright";
import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const data = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-api-ui-"));
const piDir = path.join(data, "pi-fixture"); await fs.mkdir(piDir);
const nativeFixture = path.join(data, "claude-fixture");
const codexFixture = path.join(data, "codex-fixture");
await fs.writeFile(codexFixture, `#!${process.execPath}\nconst args=process.argv.slice(2);
if(args.includes('--help')) console.log('--ignore-user-config --ignore-rules --strict-config --ephemeral --json --permission-profile');
else if(args[0]==='--version') console.log('codex-cli 0.153.4');
else if(args[0]==='login') console.error('Logged in using ChatGPT');
else {process.stdin.resume();process.stdin.on('end',()=>{
if(!args.includes('model="gpt-native-fixture"')||!args.includes('forced_login_method="chatgpt"')||process.env.OPENAI_API_KEY) process.exit(2);
for(const event of [{type:'thread.started',thread_id:'synthetic'},{type:'turn.started'},{type:'item.completed',item:{type:'agent_message',text:'官方 Codex 的合成回答。'}},{type:'turn.completed',usage:{input_tokens:20,output_tokens:10}}]) console.log(JSON.stringify(event));});}
`, { mode: 0o700 });
await fs.writeFile(nativeFixture, `#!${process.execPath}\nconst args=process.argv.slice(2);
if(args.includes('--help')) console.log('--restricted --safe-mode --tools --strict-mcp-config --no-session-persistence --setting-sources --system-prompt-file');
else if(args[0]==='auth') console.log(JSON.stringify({loggedIn:true,authMethod:'claude.ai'},null,2));
else {let input='';process.stdin.on('data',part=>input+=part);process.stdin.on('end',()=>{
if(!args.includes('--restricted')||!args.includes('--safe-mode')||args[args.indexOf('--tools')+1]!==''||process.env.ANTHROPIC_API_KEY) process.exit(2);
console.log(JSON.stringify({type:'result',subtype:'success',num_turns:1,result:'官方执行器的合成回答。'}));});}
`, { mode: 0o700 });
const errors = [];
let running;
async function launch() {
  const app = await electron.launch({
    ...(process.env.ZHIXING_DESKTOP_EXECUTABLE ? { executablePath: process.env.ZHIXING_DESKTOP_EXECUTABLE } : {}),
    args: process.env.ZHIXING_DESKTOP_EXECUTABLE && !process.env.ZHIXING_DESKTOP_DEV ? [] : [root],
    env: { ...process.env, ZHIXING_DESKTOP_TEST_DATA: data, PI_CODING_AGENT_DIR: piDir, ZHIXING_ALLOW_LIVE_PROVIDER: "0", ZHIXING_DESKTOP_LIVE_CHECK: "0" },
  });
  const page = await app.firstWindow(); page.setDefaultTimeout(12_000);
  page.on("pageerror", error => errors.push(error.message));
  await page.getByRole("button", { name: "发送消息", exact: true }).waitFor();
  // Isolated fixtures only. Mock OS encryption and HTTP; production has no test hook.
  await app.evaluate(({ safeStorage, net }) => {
    safeStorage.isAsyncEncryptionAvailable = async () => true;
    safeStorage.encryptStringAsync = async value => Buffer.from([...value].reverse().join(""));
    safeStorage.decryptStringAsync = async value => ({ result: [...value.toString()].reverse().join("") });
    const originalFetch = net.fetch.bind(net);
    net.fetch = async (url, options) => {
      if (url === "https://api.moonshot.cn/v1/chat/completions" || url === "https://api.deepseek.com/v1/chat/completions") {
        const kimi = url.includes("moonshot");
        if (options.headers.authorization !== `Bearer fixture-${kimi ? "kimi" : "deepseek"}-ui`) throw new Error("fixture_credential_crossed");
        const body = JSON.parse(options.body);
        if (body.model !== (kimi ? "kimi-k3" : "deepseek-v4-flash")) throw new Error("fixture_model_crossed");
        if (kimi && (body.thinking || !["low", "high", "max"].includes(body.reasoning_effort))) throw new Error("fixture_reasoning_invalid");
        return new Response(JSON.stringify({ choices: [{ message: { reasoning_content: "private-synthetic-reasoning", content: "连接正常。合成回答。" }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 10 } }), { headers: { "content-type": "application/json" } });
      }
      if (url === "https://compatible.example/v1/chat/completions") {
        if (options.headers.authorization !== `Bearer ${"fixture-custom-ui"}` || options.redirect !== "error") throw new Error("fixture_custom_credentials_or_redirect");
        const body = JSON.parse(options.body);
        if (body.model !== "third-party-model" || body.max_tokens > 4096 || body.thinking || body.reasoning_effort) throw new Error("fixture_custom_wire");
        return new Response(JSON.stringify({ choices: [{ message: { content: "自定义模型的合成回答。" }, finish_reason: "stop" }], usage: { prompt_tokens: 20, completion_tokens: 10 } }), { headers: { "content-type": "application/json" } });
      }
      if (url === "https://api.anthropic.com/v1/messages" || url === "https://api.openai.com/v1/responses") {
        const messages = url.endsWith("messages"), body = JSON.parse(options.body);
        const fixtureKey = "fixture-protocol-ui";
        if ((messages ? options.headers["x-api-key"] : options.headers.authorization) !== (messages ? fixtureKey : `Bearer ${fixtureKey}`) || options.redirect !== "error" || body.model !== "protocol-fixture") throw new Error("fixture_protocol_wire");
        return new Response(JSON.stringify(messages ? { type: "message", content: [{ type: "text", text: "原生协议的合成回答。" }], stop_reason: "end_turn", usage: { input_tokens: 20, output_tokens: 10 } } : { object: "response", status: "completed", output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "原生协议的合成回答。" }] }], usage: { input_tokens: 20, output_tokens: 10 } }));
      }
      if (/^https?:/i.test(String(url))) throw new Error("unexpected_test_network");
      return originalFetch(url, options);
    };
    process.env.ZHIXING_ALLOW_LIVE_PROVIDER = "1";
  });
  return { app, page };
}
try {
  running = await launch(); let { page } = running;
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: /DeepSeek API/ }).click();
  await page.getByPlaceholder("粘贴你的 DeepSeek API Key").fill("fixture-deepseek-ui");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("已加密保存 API Key。", { exact: true }).waitFor();
  await page.locator("#deepseek-api-key").fill("fixture-unsaved-draft");
  await page.getByRole("button", { name: /Kimi API/ }).click();
  assert.equal(await page.locator("#kimi-api-key").inputValue(), "");
  assert.equal(await page.getByRole("button", { name: "测试连接", exact: true }).isDisabled(), true);
  await page.getByPlaceholder("粘贴你的 Kimi API Key").fill("fixture-kimi-ui");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await page.getByText("已加密保存 API Key。", { exact: true }).waitFor();
  assert.equal(await page.locator("#kimi-api-key").inputValue(), "");
  const boot = await page.evaluate(async () => (await window.zhixing.invoke({ type: "boot" })).data);
  assert.equal(boot.api.configured, true); assert.equal(boot.kimiApi.configured, true);
  assert.ok(!JSON.stringify(boot).includes("fixture-kimi-ui"));
  for (const vendor of ["kimi", "deepseek"]) {
    assert.ok(!(await fs.readFile(path.join(data, `${vendor}.credential`))).includes(Buffer.from(`fixture-${vendor}-ui`)));
    if (process.platform !== "win32") assert.equal((await fs.stat(path.join(data, `${vendor}.credential`))).mode & 0o777, 0o600);
  }
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await page.getByText(/连接正常 · 首字/).waitFor();
  await page.screenshot({ path: path.join(os.tmpdir(), "zhixing-kimi-settings.png"), animations: "disabled" });
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("textbox", { name: "发送给知行" }).fill("这是合成测试，请简短回答。");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.locator(".assistant-message").getByText("连接正常。合成回答。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "停止生成", exact: true }).waitFor({ state: "hidden" });
  assert.equal(await page.locator(".assistant-message .demo-badge").innerText(), "Kimi API");
  assert.ok(!(await page.locator("body").innerText()).includes("private-synthetic-reasoning"));
  await running.app.close(); running = undefined;
  running = await launch(); page = running.page;
  await page.locator(".model-picker").filter({ hasText: "Kimi · K3" }).waitFor();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByText("已找到 API 配置", { exact: true }).waitFor();
  assert.equal(await page.locator("#kimi-api-key").inputValue(), "");
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await page.getByText(/连接正常 · 首字/).waitFor();
  await page.getByRole("button", { name: /DeepSeek API/ }).click();
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await page.getByText(/连接正常 · 首字/).waitFor();
  await page.getByRole("button", { name: "添加 API 连接", exact: true }).click();
  await page.getByRole("textbox", { name: "连接名称", exact: true }).fill("测试第三家");
  await page.getByRole("textbox", { name: "API 根地址", exact: true }).fill("https://compatible.example/v1");
  await page.getByRole("textbox", { name: "模型 ID", exact: true }).fill("third-party-model");
  await page.getByLabel("自定义 API Key", { exact: true }).fill("fixture-custom-ui");
  await page.getByRole("button", { name: "保存连接", exact: true }).click();
  await page.getByText("连接已保存。选择它后即可开始对话。", { exact: true }).waitFor();
  await page.getByRole("button", { name: /^测试第三家/ }).click();
  await page.getByRole("button", { name: "测试自定义连接", exact: true }).click();
  await page.getByText(/连接正常 · 首字/).waitFor();
  let customBoot = await page.evaluate(async () => (await window.zhixing.invoke({ type: "boot" })).data);
  const customId = customBoot.settings.provider;
  assert.match(customId, /^api-[a-f0-9]{32}$/);
  assert.equal(customBoot.apiConnections.connections[0].configured, true);
  assert.ok(!JSON.stringify(customBoot).includes("fixture-custom-ui"));
  assert.ok(!(await fs.readFile(path.join(data, "api-connections.json"))).includes(Buffer.from("fixture-custom-ui")));
  assert.ok(!(await fs.readFile(path.join(data, `${customId}.credential`))).includes(Buffer.from("fixture-custom-ui")));
  await page.getByRole("button", { name: "管理 测试第三家", exact: true }).click();
  assert.equal(await page.getByLabel("自定义 API Key", { exact: true }).inputValue(), "");
  assert.equal(await page.getByLabel("API 根地址", { exact: true }).getAttribute("readonly"), "");
  await page.getByLabel("连接名称", { exact: true }).fill("第三家模型");
  await page.getByRole("button", { name: "保存连接", exact: true }).click();
  await page.locator(".provider-options").getByRole("button", { name: /^第三家模型/ }).waitFor();
  const stale = await page.evaluate(async ({ revision, connection }) => {
    const { id, configured, ...definition } = connection;
    return window.zhixing.invoke({ type: "api-connection-save", revision, connection: definition });
  }, { revision: customBoot.apiConnections.revision, connection: customBoot.apiConnections.connections[0] });
  assert.equal(stale.ok, false);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("textbox", { name: "发送给知行" }).fill("使用第三家模型回答这个合成问题。");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.locator(".assistant-message").getByText("自定义模型的合成回答。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "停止生成", exact: true }).waitFor({ state: "hidden" });
  assert.equal(await page.locator(".assistant-message .demo-badge").last().innerText(), "API · third-party-model");
  await running.app.close(); running = undefined;
  running = await launch(); page = running.page;
  await page.locator(".model-picker").filter({ hasText: "第三家模型" }).waitFor();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "测试自定义连接", exact: true }).click();
  await page.getByText(/连接正常 · 首字/).waitFor();
  await page.getByRole("button", { name: "管理 第三家模型", exact: true }).click();
  await page.getByLabel("自定义 API Key", { exact: true }).scrollIntoViewIfNeeded();
  await page.locator(".connection-form").screenshot({ path: path.join(os.tmpdir(), "zhixing-custom-connections.png"), animations: "disabled" });
  await page.getByRole("button", { name: "移除连接", exact: true }).click();
  await page.getByRole("button", { name: "确认移除连接", exact: true }).click();
  await page.getByText("当前连接已移除，请选择其他模型后再发送。已有对话会保留。", { exact: true }).waitFor();
  customBoot = await page.evaluate(async () => (await window.zhixing.invoke({ type: "boot" })).data);
  assert.equal(customBoot.settings.provider, customId);
  assert.equal(customBoot.apiConnections.connections.length, 0);
  const missing = await page.evaluate(async provider => window.zhixing.invoke({ type: "check-api", provider }), customId);
  assert.equal(missing.ok, false);
  assert.match(missing.error, /移除|尚未配置/);
  await page.getByRole("button", { name: /Kimi API/ }).click();
  await page.getByRole("button", { name: "测试连接", exact: true }).click();
  await page.getByText(/连接正常 · 首字/).waitFor();
  for (const [id, label, protocol] of [["anthropic", "Anthropic · Claude", "anthropic-messages"], ["openai", "OpenAI · GPT", "openai-responses"]]) {
    await page.getByRole("button", { name: "添加 API 连接", exact: true }).click();
    assert.equal(await page.getByLabel("服务商模板", { exact: true }).locator("option").count(), 11);
    await page.getByLabel("服务商模板", { exact: true }).selectOption(id);
    assert.equal(await page.getByLabel("接口协议", { exact: true }).inputValue(), protocol);
    assert.equal(await page.getByLabel("模型 ID", { exact: true }).inputValue(), "");
    await page.getByLabel("模型 ID", { exact: true }).fill("protocol-fixture");
    await page.getByLabel("自定义 API Key", { exact: true }).fill("fixture-protocol-ui");
    await page.getByRole("button", { name: "保存连接", exact: true }).click();
    await page.getByText("连接已保存。选择它后即可开始对话。", { exact: true }).waitFor();
    await page.locator(".custom-connection-row").getByRole("button", { name: new RegExp(`^${label}`) }).click();
    await page.getByRole("button", { name: "测试自定义连接", exact: true }).click();
    await page.getByText(/连接正常 · 首字/).waitFor();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await page.getByRole("textbox", { name: "发送给知行" }).fill(`使用 ${id} 回答合成问题。`);
    await page.getByRole("button", { name: "发送消息", exact: true }).click();
    await page.locator(".assistant-message").getByText("原生协议的合成回答。", { exact: true }).last().waitFor();
    await page.getByRole("button", { name: "停止生成", exact: true }).waitFor({ state: "hidden" });
    await page.getByRole("button", { name: "设置", exact: true }).click();
  }
  await page.getByText("Claude Code 程序位置", { exact: true }).click();
  await page.getByLabel("Claude Code 可执行文件", { exact: true }).fill(nativeFixture);
  await page.getByRole("button", { name: "保存程序位置", exact: true }).click();
  await page.getByRole("button", { name: "检查官方 Agent", exact: true }).click();
  await page.locator(".connection-selected").filter({ has: page.getByText("官方 Claude Code", { exact: true }) }).getByRole("button", { name: "以单 Agent 使用", exact: true }).click();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.locator(".model-picker").filter({ hasText: "官方 Claude Code" }).waitFor();
  await page.getByRole("textbox", { name: "发送给知行" }).fill("请由官方执行器回答合成问题。");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.locator(".assistant-message").getByText("官方执行器的合成回答。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "停止生成", exact: true }).waitFor({ state: "hidden" });
  await page.getByText(/官方 Agent 返回 · 回答尚未经工具验证/).waitFor();
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByText("Codex 程序与模型", { exact: true }).click();
  await page.getByLabel("Codex 可执行文件", { exact: true }).fill(codexFixture);
  await page.getByLabel("Codex 订阅模型", { exact: true }).fill("gpt-native-fixture");
  await page.getByRole("button", { name: "保存 Codex 配置", exact: true }).click();
  await page.getByRole("button", { name: "检查官方 Agent", exact: true }).click();
  await page.locator(".connection-selected").filter({ has: page.getByText("官方 Codex", { exact: true }) }).getByRole("button", { name: "以单 Agent 使用", exact: true }).click();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.locator(".model-picker").filter({ hasText: "官方 Codex" }).waitFor();
  await page.getByRole("textbox", { name: "发送给知行" }).fill("请由 Codex 订阅执行器回答合成问题。");
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.locator(".assistant-message").getByText("官方 Codex 的合成回答。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "停止生成", exact: true }).waitFor({ state: "hidden" });
  assert.deepEqual(errors, []);
  console.log("API UI passed: independent Kimi/DeepSeek credentials, masked input, draft reset, connection test, provider badge, restart existing DeepSeek compatibility, custom vendor add/rename/key retention/select/probe/chat/restart/remove, ten templates, Messages/Responses round trips, official Claude and Codex executable/select/chat, pinned Codex model and subscription auth, stale revision and missing-provider rejection. HTTP, official process and cipher use isolated fixtures.");
} finally {
  if (running) await running.app.close();
  await fs.rm(data, { recursive: true, force: true });
}
