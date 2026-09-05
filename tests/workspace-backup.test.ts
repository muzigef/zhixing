import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { LearningApplication } from "../src/learning-application.js";
import { DesktopStore } from "../desktop/core/store.js";
import { createWorkspaceBackup, inspectWorkspaceBackup, restoreWorkspaceBackup } from "../desktop/core/workspace-backup.js";

it("backs up workspace, SQLite, artifacts and conversations without credentials, and restores into a new workspace", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-backup-full-")); const workspace = path.join(root, "workspace"); const app = await LearningApplication.open(workspace, process.cwd());
  try {
    await app.handle("开始第 1 天", "agent-development"); await app.submitEvidence("agent-development", "D01", "reflection", "这是一份需要完整恢复的学习复盘。");
    const store = new DesktopStore(path.join(root, "desktop")); const session = await store.create(); session.topicId = "agent-development"; session.workspaceId = app.summary().id; session.executionAllowed = true; await store.save(session);
    await fs.writeFile(path.join(store.root, "deepseek.credential"), "fixture-ciphertext");
    const backup = await createWorkspaceBackup(app, store, path.join(root, "exports"), "0.4.0", new AbortController().signal);
    const manifest = await inspectWorkspaceBackup(backup, new AbortController().signal);
    expect(manifest.files.some((file) => file.path.includes("zhixing.sqlite"))).toBe(true);
    expect(manifest.files.some((file) => file.path.includes("credential"))).toBe(false);
    const restored = await restoreWorkspaceBackup(backup, path.join(root, "restored"), store, new AbortController().signal);
    expect(restored.workspace).not.toBe(workspace); expect(restored.sessions).toBe(1);
    const copy = await LearningApplication.open(restored.workspace, process.cwd());
    try { expect((await copy.evidence.list("agent-development", "D01")).artifacts).toHaveLength(1); } finally { copy.close(); }
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
