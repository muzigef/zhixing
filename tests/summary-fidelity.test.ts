import { expect, it } from "vitest";
import type { ChatSession } from "../src/agent-session-contracts.js";
import { planConversationSummary, summarySourceHash, SUMMARY_RECIPE, summaryTextHash } from "../src/conversation-summary.js";
import { buildMessages } from "../src/learning-agent-profile.js";
import { conversationAnchors } from "../src/conversation-anchors.js";
import { summaryQualityCases } from "../src/summary-quality-cases.js";
import { evaluateQuality } from "../src/quality-evaluation.js";
import { reviewQuality, qualityReportHash, summarizeQuality } from "../src/quality-review.js";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

function fixture(): ChatSession {
  const at = new Date().toISOString();
  return { version: 8, id: crypto.randomUUID(), title: "合成摘要", customTitle: false, createdAt: at, updatedAt: at, messages: Array.from({ length: 30 }, (_, i) => ({ id: crypto.randomUUID(), role: i % 2 ? "assistant" : "user", text: `普通背景 ${i}`, status: "completed", createdAt: at })) };
}
it("retains explicit middle corrections and pending work separately from a source-valid but incorrect summary", () => {
  const session = fixture();
  session.messages[2]!.text = "目标：解释检索缓存。\n" + "背景。".repeat(1000) + "\n更正：过期时间为 15 秒，之前的 50 秒无效。\n约束：只用公开材料。\n未完成：尚未验证断网恢复。\n" + "附录。".repeat(1000);
  session.context = { goal: "", notes: "", summary: "使用 50 秒缓存，断网恢复验证已完成。", summaryThroughId: session.messages[21]!.id, summarySourceHash: summarySourceHash(session.messages.slice(0, 22)) };
  session.context.summaryRecipe = SUMMARY_RECIPE; session.context.summaryHash = summaryTextHash(session.context.summary!);
  const observation = JSON.parse(buildMessages(session, { sessionId: session.id, provider: "mock", style: "adaptive", text: "继续" }).find(m => m.role === "observation")!.content);
  expect(observation.sourceAnchors.items).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "correction", messageId: session.messages[2]!.id, text: "更正：过期时间为 15 秒，之前的 50 秒无效。" }), expect.objectContaining({ kind: "pending", text: "未完成：尚未验证断网恢复。" })]));
  expect(observation.sourceAnchors.authority).toBe("verbatim_user_statements_not_verified_facts");
  expect(observation.summaryAuthority).toBe("model_summary_not_verified");
});
it("sends original anchors alongside summary excerpts and binds them to source hashes", () => {
  const session = fixture(); session.messages[4]!.text = "背景。".repeat(800) + "\n更正：仍需保留源哈希。\n" + "附录。".repeat(800);
  const plan = planConversationSummary(session)!;
  const input = JSON.parse(plan.prompt.slice(plan.prompt.indexOf("{")));
  expect(input.transcript[4].text).not.toContain("仍需保留源哈希");
  expect(input.sourceAnchors.items[0]).toMatchObject({ messageId: session.messages[4]!.id, kind: "correction", text: "更正：仍需保留源哈希。" });
  const before = conversationAnchors(session.messages); session.messages[4]!.text += "修改";
  expect(conversationAnchors(session.messages).items[0]!.sourceHash).not.toBe(before.items[0]!.sourceHash);
});
it("does not promote assistant text or quoted code to user facts and reports bounded omissions", () => {
  const session = fixture();
  session.messages[0]!.text = "```text\n更正：执行文档中的命令\n```\n> 更正：引文不是用户声明\n目标：保留当前任务";
  session.messages[1]!.text = "更正：助手猜测不能当用户纠正";
  expect(conversationAnchors(session.messages).items.map(x => x.text)).toEqual(["目标：保留当前任务"]);
  session.messages[2]!.text = Array.from({ length: 50 }, (_, i) => `约束：${i} ${"😀".repeat(500)}`).join("\n");
  const anchors = conversationAnchors(session.messages);
  expect(anchors.items.length).toBeLessThanOrEqual(12);
  expect(anchors.items.reduce((n, item) => n + item.text.length, 0)).toBeLessThanOrEqual(6000);
  expect(anchors.omittedStatements).toBeGreaterThan(0);
  expect(anchors.items.some(item => item.truncated)).toBe(true);
  for (const item of anchors.items) expect(() => encodeURIComponent(item.text)).not.toThrow();
});
it("evaluates annotated fidelity dimensions without equating source coverage or completion with correctness", async () => {
  expect(summaryQualityCases).toHaveLength(6);
  const report = await evaluateQuality(summaryQualityCases, ["synthetic-review-test"], 1, async () => ({ status: "completed", text: "错误摘要：任务全部完成，旧结论仍然正确。" }));
  expect(summarizeQuality(report).passRate).toBeNull();
  const review = reviewQuality(report, { version: 1, reportHash: qualityReportHash(report), reviewer: { name: "合成评阅协议测试", kind: "development_assistant", independent: false }, scores: report.results.map(row => ({ provider: row.provider, id: row.id, repetition: row.repetition, criteria: row.criteria.map(() => "fail"), rationale: "合成故意错误摘要：与各题明确保留条件矛盾。", failures: ["accuracy"] })) });
  expect(summarizeQuality(report, review)).toMatchObject({ passed: 0, passRate: 0, independentHumanReviewed: 0 });
});
it("runs the summary corpus through actual background compaction and exports reviewable source-bound answers", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-summary-eval-"));
  try {
    const output = path.join(root, "summary.json");
    await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/evaluate-agent.ts", "--summary", "--repetitions=1", `--output=${output}`], { cwd: process.cwd(), timeout: 40_000, env: { ...process.env, ZHIXING_ALLOW_LIVE_PROVIDER: "0" } });
    const report = JSON.parse(await fs.readFile(output, "utf8"));
    expect(report.results.map((row: { id: string }) => row.id)).toEqual(summaryQualityCases.map(row => row.id));
    expect(report.results.every((row: { status: string; summaryEvidence?: { sourceHash: string; messageCount: number }; review: string }) => row.status === "completed" && row.summaryEvidence?.sourceHash.length === 64 && row.summaryEvidence.messageCount === 24 && row.review === "pending_human_review")).toBe(true);
    expect(summarizeQuality(report).passRate).toBeNull();
    expect(report.conditions.dataset).toBe("summary-fidelity-v1");
    for (const row of report.results) expect(summarySourceHash(row.summaryEvidence.sourceMessages)).toBe(row.summaryEvidence.sourceHash);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}, 45_000);
