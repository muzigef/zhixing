import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { LearningApplication } from "../src/learning-application.js";
import { DesktopStore } from "../desktop/core/store.js";
import { DesktopDemoClient, DesktopService } from "../desktop/core/service.js";
import { createWorkspaceBackup, inspectWorkspaceBackup, restoreWorkspaceBackup } from "../desktop/core/workspace-backup.js";

it("backs up workspace, SQLite, artifacts and conversations without credentials, and restores into a new workspace", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-backup-full-")); const workspace = path.join(root, "workspace"); const app = await LearningApplication.open(workspace, process.cwd());
  try {
    await app.handle("开始第 1 天", "agent-development"); await app.submitEvidence("agent-development", "D01", "reflection", "这是一份需要完整恢复的学习复盘。");
    const store = new DesktopStore(path.join(root, "desktop")); const session = await store.create(); session.topicId = "agent-development"; session.workspaceId = app.summary().id; session.executionAllowed = true; await store.save(session);
    session.messages = Array.from({ length: 600 }, (_, index) => ({ id: crypto.randomUUID(), role: "user", status: "completed", text: `需要恢复的分段原文 ${index}`, createdAt: session.createdAt }));
    session.teaching = { topicId: "agent-development", dayCard: "独立会话学习卡", stage: "practice", quizRound: 1, currentExercise: "合成问题", transcript: [], learnerAttempts: [], updatedAt: session.updatedAt };
    const trial = app.outcomes.start("agent-development", "direct");
    app.outcomes.submit("agent-development", trial.id, "pre", { answers: [-1, -1, -1], explanation: "尚未理解，需要继续学习。", assistance: "independent" });
    app.outcomes.attachSession("agent-development", trial.id, session.id);
    session.study = { id: trial.id, mode: "direct" }; await store.save(session);
    await fs.writeFile(path.join(store.root, "deepseek.credential"), "fixture-ciphertext");
    const backup = await createWorkspaceBackup(app, store, path.join(root, "exports"), "0.4.0", new AbortController().signal);
    const manifest = await inspectWorkspaceBackup(backup, new AbortController().signal);
    expect(manifest.files.some((file) => file.path.includes("zhixing.sqlite"))).toBe(true);
    expect(manifest.files.some((file) => file.path.includes("credential"))).toBe(false);
    const restored = await restoreWorkspaceBackup(backup, path.join(root, "restored"), store, new AbortController().signal);
    expect(restored.workspace).not.toBe(workspace); expect(restored.sessions).toBe(1);
    const copy = await LearningApplication.open(restored.workspace, process.cwd());
    try {
      expect((await copy.evidence.list("agent-development", "D01")).artifacts).toHaveLength(1);
      const restoredTrial = copy.outcomes.get("agent-development", trial.id);
      expect(restoredTrial.sessionId).not.toBe(session.id);
      const resumed = await new DesktopService(store, () => new DesktopDemoClient(), copy).openOutcomeLesson("agent-development", trial.id);
      expect(resumed.id).toBe(restoredTrial.sessionId); expect(resumed.workspaceId).toBe(copy.summary().id);
      expect(resumed.messages).toEqual(session.messages); expect(resumed.teaching).toEqual(session.teaching);
    } finally { copy.close(); }
    expect((await store.list()).length).toBe(2); expect((await store.load(session.id)).executionAllowed).toBe(true);
    await fs.appendFile(path.join(backup, manifest.files[0]!.path), "tampered");
    await expect(inspectWorkspaceBackup(backup, new AbortController().signal)).rejects.toThrow("backup_integrity_failed");
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
});
it("rejects linked source data instead of following it outside the workspace", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-backup-links-")); const app = await LearningApplication.open(path.join(root, "workspace"), process.cwd());
  try {
    await fs.mkdir(path.join(app.root, "learning-notes"), { recursive: true });
    await fs.symlink(root, path.join(app.root, "learning-notes", "outside"), "dir");
    await expect(createWorkspaceBackup(app, new DesktopStore(path.join(root, "desktop")), path.join(root, "exports"), "0.4.0", new AbortController().signal)).rejects.toThrow("backup_link_denied");
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
});
it("includes CLI execution sessions and restores pending approvals with grants cleared", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-backup-journal-")); const app = await LearningApplication.open(path.join(root, "workspace"), process.cwd());
  try {
    const { AgentExecutionStore } = await import("../src/agent-execution-store.js");
    const desktop = new DesktopStore(path.join(root, "desktop"));
    const cli = new DesktopStore(path.join(app.root, "zhixing/agent")); const source = await cli.create();
    source.topicId = "agent-development"; source.workspaceId = app.summary().id; source.contextAllowed = true; source.executionAllowed = true; source.permissions = { version: 1, materials: true, projectId: crypto.randomUUID(), externalRevision: 3 }; source.writeGrants = [{ key: "a".repeat(64), kind: "project", label: "合成授权" }];
    const taskId = crypto.randomUUID(); const callId = "backup-call";
    source.messages.push({ id: crypto.randomUUID(), role: "assistant", text: "", status: "waiting", createdAt: new Date().toISOString(), taskId, items: [{ id: crypto.randomUUID(), callId, kind: "approval", tool: "save_artifact", title: "保存合成产物", input: { dayId: "D01", kind: "implementation", text: "export const answer = 42;" }, status: "answered", answer: "allow" }] });
    await cli.save(source);
    const journal = new AgentExecutionStore(app.database, { taskId, sessionId: source.id, topicId: source.topicId }); const release = journal.claim();
    journal.save({ version: 1, status: "waiting", prompt: "合成备份任务", containsMaterials: true, history: [], decisions: { [callId]: { answer: "allow", scope: "once" } }, pending: { events: [{ type: "tool_call", tool: "save_artifact", callId, input: {} }], toolResults: [], phase: "waiting", next: 0 } }, "fixture"); release();
    const releaseTeaching = AgentExecutionStore.claimTeaching(app.database, "agent-development");
    const backup = await createWorkspaceBackup(app, desktop, path.join(root, "exports"), "0.4.1", new AbortController().signal);
    releaseTeaching();
    const restored = await restoreWorkspaceBackup(backup, path.join(root, "copies"), desktop, new AbortController().signal);
    const copy = await LearningApplication.open(restored.workspace, process.cwd());
    try {
      const releaseRestored = AgentExecutionStore.claimTeaching(copy.database, "agent-development"); releaseRestored();
      const session = await new DesktopStore(path.join(restored.workspace, "zhixing/agent")).load(source.id);
      expect(session.executionAllowed).toBe(false); expect(session.contextAllowed).toBe(false); expect(session.permissions).toEqual({ version: 1, materials: false }); expect(session.writeGrants).toEqual([]); expect(session.workspaceId).toBe(copy.summary().id);
      expect(session.messages[0]?.items?.[0]).toMatchObject({ status: "pending" });
      const checkpoint = new AgentExecutionStore(copy.database, { taskId, sessionId: source.id, topicId: source.topicId }).read();
      expect(checkpoint?.decisions).toEqual({}); expect(checkpoint?.status).toBe("interrupted");
    } finally { copy.close(); }
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
});
import { ApiConnections } from "../src/api-connections.js";
import { apiConnectionInputSchema } from "../src/api-connection-config.js";

it("backs up and restores public API definitions without copying credentials or replacing existing connections", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-backup-api-")); const app = await LearningApplication.open(path.join(root, "workspace"), process.cwd());
  try {
    const desktop = new DesktopStore(path.join(root, "desktop"));
    const profiles = new ApiConnections(path.join(desktop.root, "api-connections.json"));
    const definition = apiConnectionInputSchema.parse({ name: "原始名称", baseUrl: "https://compatible.example/v1", model: "test-model" });
    const saved = await profiles.save(definition, 0);
    await fs.writeFile(path.join(desktop.root, `${saved.connections[0]!.id}.credential`), "synthetic-encrypted-bytes");
    const backup = await createWorkspaceBackup(app, desktop, path.join(root, "exports"), "0.9.2", new AbortController().signal);
    const manifest = await inspectWorkspaceBackup(backup, new AbortController().signal);
    expect(manifest.files.some(file => file.path === "desktop/api-connections.json")).toBe(true);
    expect(manifest.files.some(file => file.path.includes("credential"))).toBe(false);
    const destination = new DesktopStore(path.join(root, "other-desktop"));
    const other = new ApiConnections(path.join(destination.root, "api-connections.json"));
    await other.save({ ...definition, name: "现在的名称" }, 0);
    await restoreWorkspaceBackup(backup, path.join(root, "restored"), destination, new AbortController().signal);
    expect((await other.load()).connections).toHaveLength(1);
    expect((await other.load()).connections[0]!.name).toBe("现在的名称");
    expect((await fs.readdir(destination.root)).some(file => file.endsWith(".credential"))).toBe(false);
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
});
