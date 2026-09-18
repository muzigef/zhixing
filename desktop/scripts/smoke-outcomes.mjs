import { createHash, randomUUID } from "node:crypto";
import { _electron as electron } from "playwright";
import { strict as assert } from "node:assert";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const data = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-outcomes-ui-"));
const errors = []; let running;
async function launch() {
  const app = await electron.launch({
    ...(process.env.ZHIXING_DESKTOP_EXECUTABLE ? { executablePath: process.env.ZHIXING_DESKTOP_EXECUTABLE } : {}),
    args: process.env.ZHIXING_DESKTOP_EXECUTABLE && !process.env.ZHIXING_DESKTOP_DEV ? [] : [root],
    env: { ...process.env, ZHIXING_DESKTOP_TEST_DATA: data, PI_CODING_AGENT_DIR: path.join(data, "pi-empty"), ZHIXING_ALLOW_LIVE_PROVIDER: "0", ZHIXING_DESKTOP_LIVE_CHECK: "0" }, timeout: 30_000,
  });
  const page = await app.firstWindow(); page.setDefaultTimeout(15_000);
  page.on("pageerror", error => errors.push(error.message));
  await page.getByRole("combobox", { name: "学习主题", exact: true }).waitFor();
  return { app, page };
}
async function answer(page, phase, assistance) {
  const panel = page.getByRole("region", { name: "学习效果验证" });
  const submit = panel.getByRole("button", { name: `保存${phase}`, exact: true });
  assert.equal(await submit.isDisabled(), true);
  for (const field of await panel.locator("fieldset").all()) await field.getByRole("radio", { name: "暂时不会", exact: true }).check();
  await panel.getByRole("textbox", { name: "学习验证解释" }).fill("这是合成 UI 作答：我还不能独立解释证据支持关系，需要继续学习。");
  assert.equal(await submit.isDisabled(), true);
  await panel.getByRole("combobox", { name: "检查作答方式" }).selectOption(assistance);
  assert.equal(await submit.isDisabled(), true);
  await panel.getByRole("textbox", { name: "学习验证迁移例子", exact: true }).fill("合成迁移作答：换成医疗证据时，我暂时不会独立判断适用范围。");
  await submit.click(); await submit.waitFor({ state: "hidden" });
}
try {
  running = await launch(); let { page } = running;
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByRole("button", { name: "离线演示 无需联网，体验界面与交互" }).click();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("combobox", { name: "学习主题", exact: true }).selectOption("rag");
  await page.getByRole("button", { name: "课程与资料", exact: true }).click();
  await page.getByRole("combobox", { name: "验证学习方式" }).selectOption("direct");
  await page.getByRole("button", { name: "开始学习验证", exact: true }).click();
  await answer(page, "学前检查", "independent");
  await page.getByRole("button", { name: "进入本次学习对话", exact: true }).waitFor();
  await running.app.close(); running = await launch(); page = running.page;
  await page.getByRole("combobox", { name: "学习主题", exact: true }).selectOption("rag");
  await page.getByRole("button", { name: "课程与资料", exact: true }).click();
  await page.getByRole("button", { name: "进入本次学习对话", exact: true }).click();
  await page.locator(".study-banner").getByText(/同模型直接聊天/).waitFor();
  assert.equal(await page.getByRole("checkbox", { name: /本会话使用学习上下文/ }).count(), 0);
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.getByRole("button", { name: "停止生成", exact: true }).waitFor({ state: "hidden" });
  await page.locator(".assistant-message").waitFor();
  await page.getByRole("button", { name: "课程与资料", exact: true }).click();
  await page.getByRole("button", { name: "结束学习，开始学后检查", exact: true }).click();
  await answer(page, "学后检查", "hint");
  assert.equal(await page.getByRole("button", { name: "开始延迟复习", exact: true }).isDisabled(), true);
  const snapshot = await page.evaluate(async () => window.zhixing.invoke({ type: "outcome-list", topicId: "rag" }));
  assert.equal(snapshot.ok, true); const trial = snapshot.data.trials[0];
  assert.equal(trial.protocol, "full_product"); assert.match(trial.provenance.codeHash, /^[a-f0-9]{64}$/);
  assert.equal(trial.lesson.conditions[0].codeHash, trial.provenance.codeHash);
  assert.equal(trial.stage, "waiting"); assert.equal(trial.results.pre.correctCount, 0);
  assert.match(trial.results.pre.transferExample, /合成迁移作答/);
  assert.ok(trial.results.pre.transferPrompt);
  assert.equal(trial.results.post.assistance, "hint"); assert.equal(trial.feedback, undefined);
  assert.equal(snapshot.data.report.exclusions.demo, 1);
  const early = await page.evaluate(async id => window.zhixing.invoke({ type: "outcome-retention", topicId: "rag", id }), trial.id);
  assert.equal(early.ok, false); assert.match(early.error, /满 3 天/);
  const exported = path.join(data, "outcome-export.json");
  await running.app.evaluate(({ dialog }, destination) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: destination }); }, exported);
  await page.getByRole("button", { name: "导出验证记录（含作答）", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector(".outcome-panel > button:last-of-type")?.disabled);
  const report = JSON.parse(await fs.readFile(exported, "utf8"));
  assert.equal(report.assignment, "learner_selected"); assert.equal(report.trials[0].results.pre.explanationReview, "pending_human_review");
  assert.equal(report.trials[0].results.pre.transferExample, trial.results.pre.transferExample);
  const captures = path.join(os.tmpdir(), "zhixing-desktop-preview"); await fs.mkdir(captures, { recursive: true });
  await page.screenshot({ path: path.join(captures, "learning-outcomes.png"), animations: "disabled" });
  await page.getByText("暂不继续这次验证", { exact: true }).click();
  await page.getByRole("button", { name: "结束验证并保留记录", exact: true }).click();
  await page.locator(".outcome-record > summary").first().click();
  const review = page.locator(".outcome-review").first();
  await review.locator("summary").first().click();
  await review.getByRole("textbox", { name: "解释复核者", exact: true }).fill("合成 UI 评分者");
  await review.getByRole("textbox", { name: "解释复核依据", exact: true }).fill("合成复核：需要补充结论对应的材料证据。");
  assert.equal(await review.getByRole("checkbox", { name: "我未参与这次教学或回答生成，并独立完成本次评阅", exact: true }).isChecked(), false);
  await review.getByRole("combobox", { name: "迁移复核判断", exact: true }).selectOption("unsupported");
  await review.getByRole("button", { name: "保存解释复核", exact: true }).click();
  await review.locator(".explanation-review-result").getByText(/合成 UI 评分者/).waitFor();
  await review.getByRole("combobox", { name: "解释复核判断", exact: true }).selectOption("withdrawn");
  await review.getByRole("textbox", { name: "解释复核依据", exact: true }).fill("合成撤回：等待再次核对。");
  await review.getByRole("button", { name: "保存解释复核", exact: true }).click();
  await review.locator(".explanation-review-result").getByText(/已撤回评分/).waitFor();
  const reviewed = await page.evaluate(async () => window.zhixing.invoke({ type: "outcome-list", topicId: "rag" }));
  assert.equal(reviewed.data.trials[0].results.pre.correctCount, 0);
  assert.equal(reviewed.data.trials[0].results.pre.reviews.length, 2);
  assert.deepEqual(reviewed.data.trials[0].results.pre.reviews[0].declaration, { kind: "human", independent: false });
  assert.equal(reviewed.data.trials[0].results.pre.reviews[0].transferVerdict, "unsupported");
  await page.getByRole("combobox", { name: "验证学习方式" }).selectOption("zhixing");
  await page.getByRole("button", { name: "开始学习验证", exact: true }).click();
  await page.getByText(/本次作为重复练习保留/).waitFor();
  await answer(page, "学前检查", "independent");
  await page.getByRole("button", { name: "进入本次学习对话", exact: true }).click();
  await page.getByRole("checkbox", { name: /本会话使用学习上下文/ }).check();
  await page.getByRole("button", { name: "发送消息", exact: true }).click();
  await page.getByRole("button", { name: "停止生成", exact: true }).waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "课程与资料", exact: true }).click();
  await page.getByRole("button", { name: "结束学习，开始学后检查", exact: true }).click();
  await page.getByRole("button", { name: "保存学后检查", exact: true }).waitFor();
  const product = await page.evaluate(async () => window.zhixing.invoke({ type: "outcome-list", topicId: "rag" }));
  assert.equal(product.data.trials[0].lesson.access[0].materials, true);
  assert.equal(product.data.trials[0].protocol, "full_product");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("combobox", { name: "学习主题", exact: true }).selectOption("agent-development");
  await page.getByRole("button", { name: "课程与资料", exact: true }).click();
  await page.getByRole("button", { name: "开始学习验证", exact: true }).waitFor();
  assert.equal(await page.locator(".outcome-record").count(), 0);
  await page.getByText("参加已分组的教学研究", { exact: true }).click();
  const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const plan = { version: 1, topicId: "agent-development", protocol: "full_product", codeHash: "a".repeat(64), provider: "demo", model: "fixture", reasoning: "quick", style: "adaptive", minimumLearningMs: 1000, primaryMetric: "delayed_correct", minimumRetentionHours: 72, plannedParticipants: 2, sampleRationale: "合成界面流程验证，不是效力研究或真实学习者记录。", hypothesis: "合成数据仅验证分组导入正确性。", missingRule: "bounds", dataOrigin: "synthetic", allocation: "simple_random_1_to_1" };
  const body = { version: 1, plan, planHash: digest(plan), registryHash: "b".repeat(64), assignment: { participantCode: "P001", trialId: randomUUID(), mode: "direct", assignedAt: "2026-09-01T00:00:00.000Z" } };
  const ticket = { ...body, ticketHash: digest(body) };
  await page.getByLabel("研究分组文件", { exact: true }).setInputFiles({ name: "synthetic-ticket.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(ticket)) });
  await page.getByText(/研究代号 P001/).waitFor();
  const assigned = await page.evaluate(async ticket => window.zhixing.invoke({ type: "outcome-enroll", topicId: "agent-development", ticket }), ticket);
  assert.equal(assigned.ok, true); assert.equal(assigned.data.id, ticket.assignment.trialId); assert.equal(assigned.data.mode, "direct");
  const mismatch = await page.evaluate(async ticket => window.zhixing.invoke({ type: "outcome-enroll", topicId: "rag", ticket }), ticket);
  assert.equal(mismatch.ok, false);
  assert.deepEqual(errors, []);
  console.log("Outcome UI passed: explicit learner answers/help, restart recovery, direct-chat isolation, real session binding, post-check, early retention denial, local export, repeat marking and topic isolation. Synthetic demo only; no learning-effect claim.");
} catch (error) {
  if (running) await running.page.screenshot({ path: path.join(os.tmpdir(), "zhixing-outcomes-failure.png") });
  throw error;
} finally {
  if (running) await running.app.close();
  await fs.rm(data, { recursive: true, force: true });
}
