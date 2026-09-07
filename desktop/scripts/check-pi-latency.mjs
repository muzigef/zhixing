import { _electron as electron } from "playwright";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

if (!process.argv.includes("--live")) throw new Error("explicit_live_flag_required");
if (process.env.ZHIXING_ALLOW_LIVE_PROVIDER === "0") throw new Error("live_provider_disabled");
const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice(9);
if (!output) throw new Error("explicit_output_required");
const root = path.resolve(import.meta.dirname, "..");
const data = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-pi-package-latency-"));
let app;
const report = { syntheticOnly: true, startedAt: new Date().toISOString(), packaged: Boolean(process.env.ZHIXING_DESKTOP_EXECUTABLE), results: [] };
const save = () => fs.writeFile(path.resolve(output), JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
try {
  app = await electron.launch({
    ...(process.env.ZHIXING_DESKTOP_EXECUTABLE ? { executablePath: process.env.ZHIXING_DESKTOP_EXECUTABLE } : {}),
    args: process.env.ZHIXING_DESKTOP_EXECUTABLE ? [] : [root],
    env: { ...process.env, ZHIXING_PI_TRANSPORT: "sse", ZHIXING_DESKTOP_TEST_DATA: data, ZHIXING_ALLOW_LIVE_PROVIDER: "1", ZHIXING_DESKTOP_LIVE_CHECK: "0" },
  });
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "发送消息", exact: true }).waitFor();
  report.version = await app.evaluate(({ app }) => app.getVersion());
  assert.equal(report.version, "0.4.1");
  const initial = await page.evaluate(async () => {
    const call = async (command) => { const result = await window.zhixing.invoke(command); if (!result.ok) throw new Error(result.error); return result.data; };
    await call({ type: "learning-action", topicId: "agent-development", command: "开始第 1 天" });
    return { model: (await call({ type: "boot" })).model, overview: await call({ type: "learning-overview", topicId: "agent-development" }) };
  });
  assert.ok(initial.overview.days.some((day) => day.dayId === "D01" && day.state === "进行中"));
  report.model = initial.model;
  const cases = [
    { id: "text", text: "2+2 等于几？只回复一个数字。" },
    { id: "tool", context: true, text: "请实际调用 learning_progress 工具，然后用一句话告诉我当前学习日及状态。" },
    { id: "context", context: true, text: "我现在学到哪一天了？当前是什么状态？一句话回答。" },
    { id: "context-2", context: true, text: "我现在学到哪一天了？当前是什么状态？一句话回答。" },
    { id: "context-3", context: true, text: "我现在学到哪一天了？当前是什么状态？一句话回答。" },
    { id: "R01", text: "用两段话解释 RAG 与微调的区别，给出一个适用场景。" },
    { id: "cancel", cancel: true, text: "详细解释数据库索引。" },
  ];
  for (const task of cases) {
    const result = await page.evaluate(async (task) => {
      const call = async (command) => { const result = await window.zhixing.invoke(command); if (!result.ok) throw new Error(result.error); return result.data; };
      const session = await call({ type: "new" });
      const phases = []; let cancelled = false;
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { unsubscribe(); reject(new Error("live_check_timeout")); }, 190000);
        const unsubscribe = window.zhixing.subscribe((event) => {
          if (event.type === "session" && event.session.id === session.id) {
            for (const activity of event.session.messages.at(-1)?.activities ?? []) if (!phases.includes(activity.label)) phases.push(activity.label);
            if (task.cancel && !cancelled && phases.includes("正在请求模型")) { cancelled = true; void call({ type: "stop" }).catch(reject); }
          }
          if (event.type === "settled" && event.sessionId === session.id) { clearTimeout(timer); unsubscribe(); resolve(); }
        });
        void call({ type: "send", sessionId: session.id, text: task.text, provider: "pi-codex", style: "adaptive", reasoning: "balanced", ...(task.context ? { topicId: "agent-development", contextAllowed: true } : {}) }).catch((error) => { clearTimeout(timer); unsubscribe(); reject(error); });
      });
      const message = (await call({ type: "load", sessionId: session.id })).messages.at(-1);
      return { id: task.id, text: message.text, status: message.status, error: message.error, durationMs: message.durationMs, firstTokenMs: message.firstTokenMs, timings: message.timings, modelTimings: message.modelTimings, phases };
    }, task);
    report.results.push(result); await save();
    assert.equal(result.status, task.cancel ? "interrupted" : "completed");
    if (task.id === "text") assert.equal(result.text.trim(), "4");
    if (task.context) { assert.match(result.text, /D01|第\s*1\s*天/); assert.match(result.text, /进行中/); }
    if (task.id === "tool") assert.equal(result.timings.toolCalls, 1);
    if (task.id.startsWith("context")) assert.equal(result.timings.toolCalls, 0, "fresh application progress must not require a duplicate tool query");
    if (task.id === "R01") { assert.equal(result.text.trim().split(/\n\s*\n/).length, 2); assert.match(result.text, /RAG/); assert.match(result.text, /微调/); }
    if (!task.cancel) {
      assert.ok(result.modelTimings.length > 0);
      assert.ok(result.modelTimings.every((timing) => timing.transport === "sse"));
      assert.ok(result.phases.includes("等待模型内容"));
    }
    console.log(JSON.stringify({ id: task.id, status: result.status, durationMs: result.durationMs, turns: result.timings?.turns, toolCalls: result.timings?.toolCalls }));
  }
  report.diagnostics = await page.evaluate(async () => (await window.zhixing.invoke({ type: "diagnostics" })).data);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByText("按模型、思考强度与传输方式查看", { exact: true }).click();
  await page.getByText(/完成后收尾/).first().waitFor();
  await page.screenshot({ path: path.resolve(output).replace(/\.json$/, ".png"), animations: "disabled" });
  await save();
} finally { await app?.close(); await fs.rm(data, { recursive: true, force: true }); }
