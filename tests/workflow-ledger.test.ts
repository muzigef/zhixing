import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ZhixingDatabase } from "../src/database.js";
import { WorkflowLedger } from "../src/workflow-ledger.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
describe("workflow ledger", () => {
  it("persists recoverable runs and step outcomes without storing command text", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-ledger-")); roots.push(root);
    const db = new ZhixingDatabase(path.join(root, "db.sqlite")); const ledger = new WorkflowLedger(db);
    ledger.begin("run-1", "rag", "learning.start_day", "开始第 1 天"); ledger.step("run-1", "command", "started");
    expect(ledger.recoverable("rag")).toEqual([{ runId: "run-1", actionId: "learning.start_day", stateVersion: 1 }]);
    ledger.finish("run-1", "completed"); expect(ledger.recoverable("rag")).toEqual([]);
    expect(() => ledger.begin("run-2", "rag", "learning.start_day", "开始第 1 天")).not.toThrow();
    expect(JSON.stringify(db.db.prepare("SELECT * FROM workflow_runs").all())).not.toContain("开始第"); db.close();
  });
  it("marks stale foreground work as interrupted instead of replaying it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-ledger-")); roots.push(root);
    const db = new ZhixingDatabase(path.join(root, "db.sqlite")); const ledger = new WorkflowLedger(db);
    ledger.begin("run-stale", "rag", "learning.start_day", "开始第 1 天");
    expect(ledger.reconcileInterrupted()).toBe(1);
    expect(db.db.prepare("SELECT status, error_code AS errorCode FROM workflow_runs WHERE run_id = 'run-stale'").get()).toEqual({ status: "failed", errorCode: "process_interrupted" });
    db.close();
  });
  it("exposes a privacy-safe recent run snapshot for diagnostics", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-ledger-")); roots.push(root);
    const db = new ZhixingDatabase(path.join(root, "db.sqlite")); const ledger = new WorkflowLedger(db);
    ledger.begin("run-history", "rag", "learning.start_day", "开始第 1 天"); ledger.finish("run-history", "failed", "provider_timeout");
    expect(ledger.recent("rag")).toEqual([expect.objectContaining({ actionId: "learning.start_day", status: "failed", errorCode: "provider_timeout" })]);
    expect(JSON.stringify(ledger.recent("rag"))).not.toContain("开始第"); db.close();
  });
});
