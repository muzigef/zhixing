import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuditLogger } from "../src/audit.js";
import { PathPolicy } from "../src/paths.js";
import { RunManager } from "../src/run-manager.js";
import { WorkflowLedger } from "../src/workflow-ledger.js";
import { ZhixingDatabase } from "../src/database.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe("RunManager", () => {
  it("releases the foreground slot when initial audit persistence fails", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-audit-failure-")); roots.push(root);
    const logger = new AuditLogger(new PathPolicy(root));
    vi.spyOn(logger, "append").mockRejectedValueOnce(new Error("disk_failure"));
    const manager = new RunManager(logger);
    await expect(manager.run("rag", "first", async () => "never")).rejects.toThrow("disk_failure");
    await expect(manager.run("rag", "second", async () => "ok")).resolves.toBe("ok");
  });
  it("does not persist raw provider error text in the workflow ledger", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-error-code-")); roots.push(root);
    const database = new ZhixingDatabase(path.join(root, "db.sqlite"));
    try {
      const manager = new RunManager(new AuditLogger(new PathPolicy(root)), new WorkflowLedger(database));
      await expect(manager.run("rag", "request", async () => { throw new Error("provider_unavailable: private learner response"); })).rejects.toThrow("provider_unavailable");
      expect(database.db.prepare("SELECT error_code AS code FROM workflow_runs").get()).toEqual({ code: "provider_unavailable" });
    } finally { database.close(); }
  });
  it("records AbortError consistently as cancelled in both audit and ledger", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-abort-ledger-")); roots.push(root);
    const database = new ZhixingDatabase(path.join(root, "db.sqlite"));
    try {
      const manager = new RunManager(new AuditLogger(new PathPolicy(root)), new WorkflowLedger(database));
      await expect(manager.run("rag", "request", async () => { throw new DOMException("cancelled", "AbortError"); })).rejects.toThrow("cancelled");
      expect(database.db.prepare("SELECT status FROM workflow_runs").get()).toEqual({ status: "cancelled" });
    } finally { database.close(); }
  });
  it("E07：取消进行中的 Run，随后可启动新 Run", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-cancel-"));
    roots.push(root);
    const manager = new RunManager(new AuditLogger(new PathPolicy(root)));
    const pending = manager.run("rag", "stream", async (signal) => await new Promise<string>((_resolve, reject) => signal.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true })));
    await manager.cancel();
    await expect(pending).rejects.toThrow("cancelled");
    await expect(manager.run("rag", "next", async () => "ok")).resolves.toBe("ok");
    const audit = await fs.readFile(path.join(root, "zhixing", "data", "audit", "rag", new Date().toISOString().slice(0, 10) + ".jsonl"), "utf8");
    expect(audit).toContain("run_cancelled");
    expect(audit).toContain("tool_started");
    expect(audit).toContain("tool_finished");
  });
  it("persists the semantic action id rather than a generic CLI label", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-run-ledger-"));
    roots.push(root);
    const database = new ZhixingDatabase(path.join(root, "db.sqlite"));
    const manager = new RunManager(new AuditLogger(new PathPolicy(root)), new WorkflowLedger(database));
    await expect(manager.run("rag", "开始第 1 天", async () => "ok", "learning.start_day")).resolves.toBe("ok");
    expect(database.db.prepare("SELECT action_id AS actionId, status FROM workflow_runs").get()).toEqual({ actionId: "learning.start_day", status: "completed" });
    database.close();
  });
});
