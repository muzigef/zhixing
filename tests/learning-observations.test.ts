import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { LearningApplication } from "../src/learning-application.js";
import { createWorkspaceBackup, restoreWorkspaceBackup } from "../desktop/core/workspace-backup.js";
import { DesktopStore } from "../desktop/core/store.js";

it("captures only actual submissions, scopes feedback, preserves corrections/retractions across restart and backup", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-observations-")); let app = await LearningApplication.open(path.join(root, "workspace"), process.cwd());
  try {
    await app.handle("开始第 1 天", "agent-development");
    const attempt = await app.startAssessment("agent-development", "D01"); expect(app.observations.list("agent-development")).toEqual([]);
    const result = await app.submitAssessment("agent-development", "D01", attempt.id, [0, 2], "我自己区分了模型声明与执行证据。", "hint");
    expect(Date.parse(result.reviewAt) - Date.parse(result.submittedAt)).toBe(86400000);
    const observation = app.observations.list("agent-development")[0]!;
    expect(observation).toMatchObject({ id: result.id, assistance: "hint", original: result.reflection, source: { kind: "assessment", dayId: "D01" }, revision: 1 });
    expect(app.observations.list("rag")).toEqual([]);
    expect((await app.context("agent-development", "根据我的练习情况建议下一步", true, new AbortController().signal)).text).toContain(result.reflection);
    expect((await app.context("agent-development", "根据我的练习情况建议下一步", false, new AbortController().signal)).text).not.toContain(result.reflection);
    expect(() => app.observations.update("rag", observation.id, 1, "changed", false)).toThrow("cross_topic_denied");
    app.observations.update("agent-development", observation.id, 1, "更正：这次看过提示，还需要独立复查。", false);
    expect(() => app.observations.update("agent-development", observation.id, 1, "stale", false)).toThrow("observation_conflict");
    app.close(); app = await LearningApplication.open(path.join(root, "workspace"), process.cwd());
    expect(app.observations.list("agent-development")[0]?.annotation).toContain("更正");
    app.observations.update("agent-development", observation.id, 2, "", true);
    expect((await app.context("agent-development", "根据我的练习情况建议下一步", true, new AbortController().signal)).text).not.toContain(result.reflection);
    const store = new DesktopStore(path.join(root, "chats")); const backup = await createWorkspaceBackup(app, store, path.join(root, "exports"), "0.5.0", new AbortController().signal);
    const restored = await restoreWorkspaceBackup(backup, path.join(root, "copies"), store, new AbortController().signal); const copy = await LearningApplication.open(restored.workspace, process.cwd());
    try { expect(copy.observations.list("agent-development")[0]).toMatchObject({ withdrawn: true, revision: 3, original: result.reflection }); } finally { copy.close(); }
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
});
it("allows source-bound human explanation review and retraction without changing choice scores or exposing study answers to teaching context", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-explanation-review-")); const app = await LearningApplication.open(path.join(root, "workspace"), process.cwd());
  try {
    const trial = app.outcomes.start("agent-development", "direct");
    app.outcomes.submit("agent-development", trial.id, "pre", { answers: [0, -1, 2], explanation: "合成作答：真实测试结果是必要证据。", assistance: "independent" });
    const review = { expectedExplanation: "合成作答：真实测试结果是必要证据。", expectedRevision: 0, reviewer: "合成测试评分者", verdict: "partial" as const, feedback: "还需要说明产物来源。" };
    expect(() => app.outcomes.reviewExplanation("agent-development", trial.id, "pre", review)).toThrow("outcome_review_not_ready");
    app.outcomes.abandon("agent-development", trial.id);
    const before = app.outcomes.get("agent-development", trial.id).results.pre!;
    expect(() => app.outcomes.reviewExplanation("agent-development", trial.id, "pre", { ...review, expectedExplanation: "别的回答" })).toThrow("outcome_review_conflict");
    app.outcomes.reviewExplanation("agent-development", trial.id, "pre", review);
    const after = app.outcomes.get("agent-development", trial.id).results.pre!;
    expect(after.correctCount).toBe(before.correctCount); expect(after.explanationReview).toBe("human_reviewed"); expect(after.reviews?.[0]).toMatchObject({ verdict: "partial", reviewer: review.reviewer });
    app.outcomes.reviewExplanation("agent-development", trial.id, "pre", { ...review, expectedRevision: 1, verdict: "withdrawn", feedback: "撤回本次评分，等待重新复核。" });
    expect(app.outcomes.get("agent-development", trial.id).results.pre).toMatchObject({ explanationReview: "withdrawn" });
    expect((await app.context("agent-development", "我的练习情况", true, new AbortController().signal)).text).not.toContain("合成作答");
    const store = new DesktopStore(path.join(root, "chats"));
    const backup = await createWorkspaceBackup(app, store, path.join(root, "exports-parent"), "0.5.0", new AbortController().signal);
    const restored = await restoreWorkspaceBackup(backup, path.join(root, "copies"), store, new AbortController().signal);
    const copy = await LearningApplication.open(restored.workspace, process.cwd());
    try { expect(copy.outcomes.get("agent-development", trial.id).results.pre?.reviews).toEqual(app.outcomes.get("agent-development", trial.id).results.pre?.reviews); } finally { copy.close(); }
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
});

it("rejects an in-workspace backup destination even through an existing parent symlink", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-backup-parent-")); const app = await LearningApplication.open(path.join(root, "workspace"), process.cwd());
  try {
    await fs.symlink(app.root, path.join(root, "alias"), "dir");
    await expect(createWorkspaceBackup(app, new DesktopStore(path.join(root, "chats")), path.join(root, "alias", "exports"), "0.5.0", new AbortController().signal)).rejects.toThrow("backup_destination_invalid");
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
});
