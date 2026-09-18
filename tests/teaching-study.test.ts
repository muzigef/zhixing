import { expect, it } from "vitest";
import { createTeachingStudy, studyTicket, inspectTeachingStudy, validateStudyTicket } from "../src/teaching-study.js";
import { LearningOutcomeStore } from "../src/learning-outcomes.js";
import { ZhixingDatabase } from "../src/database.js";
const now = "2026-09-01T00:00:00.000Z";
const plan = { version: 1, topicId: "rag", protocol: "full_product", codeHash: "a".repeat(64), provider: "native-codex", model: "fixture", reasoning: "quick", style: "adaptive", minimumLearningMs: 1000, primaryMetric: "delayed_correct", minimumRetentionHours: 72, plannedParticipants: 4, sampleRationale: "合成可行性试用，检查失访处理，不用于推断统计效力。", missingRule: "bounds", hypothesis: "预先记录主要比较，不以结果选择指标。", dataOrigin: "synthetic", allocation: "simple_random_1_to_1" };
it("freezes a roster before collection, preserves assignments and all randomized denominators", () => {
  const registry = createTeachingStudy(plan, ["P001", "P002", "P003", "P004"], now);
  expect(registry.assignments).toHaveLength(4);
  expect(new Set(registry.assignments.map(a => a.trialId)).size).toBe(4);
  expect(studyTicket(registry, "P001")).toEqual(studyTicket(registry, "P001"));
  const report = inspectTeachingStudy(registry, []);
  expect(report).toMatchObject({ randomized: 4, observed: 0, missing: 4, realStudyVerified: false, causalEffectEstablished: false });
  expect(report.arms.reduce((n, arm) => n + arm.assigned, 0)).toBe(4);
  for (const arm of report.arms.filter(a => a.assigned)) expect(arm.primaryBounds).toEqual([0, 3]);
  const tampered = structuredClone(registry); tampered.plan.primaryMetric = "post_correct" as never;
  expect(() => inspectTeachingStudy(tampered, [])).toThrow();
  expect(() => createTeachingStudy(plan, ["P001", "P001", "P002", "P003"], now)).toThrow();
});
it("starts the assigned arm through the shared store, is idempotent, and refuses contaminated workspaces", () => {
  const registry = createTeachingStudy(plan, ["P001", "P002", "P003", "P004"], now), ticket = studyTicket(registry, "P001");
  const db = new ZhixingDatabase(":memory:"), store = new LearningOutcomeStore(db, () => new Date("2026-09-02T00:00:00.000Z"));
  try {
    const trial = store.startAssigned(ticket);
    expect(trial).toMatchObject({ id: ticket.assignment.trialId, mode: ticket.assignment.mode, protocol: "full_product", repeated: false, study: { registryHash: registry.registryHash, participantCode: "P001" } });
    expect(store.startAssigned(ticket)).toEqual(trial);
    store.abandon("rag", trial.id);
    expect(() => store.startAssigned(studyTicket(registry, "P002"))).toThrow("study_requires_unused_topic");
    const exported = { version: 1, exportedAt: "2026-09-02T01:00:00.000Z", topicId: "rag", assignment: "randomized", trials: [store.get("rag", trial.id)] };
    const report = inspectTeachingStudy(registry, [exported, exported]);
    expect(report).toMatchObject({ randomized: 4, started: 1, observed: 0, missing: 4, duplicateExports: 1 });
    expect(report.records.find(r => r.participantCode === "P001")!.deviations).toContain("abandoned");
    const changed = structuredClone(ticket); changed.assignment.mode = changed.assignment.mode === "direct" ? "zhixing" : "direct";
    expect(() => validateStudyTicket(changed)).toThrow("study_ticket_invalid");
  } finally { db.close(); }
});
it("rejects retroactive assignments and refuses to relabel self-selected records as randomized", () => {
  const registry = createTeachingStudy(plan, ["P001", "P002", "P003", "P004"], now);
  const db = new ZhixingDatabase(":memory:"), store = new LearningOutcomeStore(db, () => new Date("2026-08-31T00:00:00.000Z"));
  try { expect(() => store.startAssigned(studyTicket(registry, "P001"))).toThrow("study_assignment_in_future"); } finally { db.close(); }
});
it("keeps assisted and changed-condition observations in ITT, reports missing bounds and predefined zero imputation", () => {
  for (const missingRule of ["bounds", "zero_imputation"]) {
    const registry = createTeachingStudy({ ...plan, missingRule }, ["P001", "P002", "P003", "P004"], now), ticket = studyTicket(registry, "P001");
    let time = new Date("2026-09-02T00:00:00.000Z"); const db = new ZhixingDatabase(":memory:"), store = new LearningOutcomeStore(db, () => time);
    try {
      const trial = store.startAssigned(ticket), submission = { answers: [0, 0, 0], explanation: "合成作答", transferExample: "合成迁移", assistance: "hint" }, sessionId = crypto.randomUUID();
      store.submit("rag", trial.id, "pre", submission); store.attachSession("rag", trial.id, sessionId);
      store.finishLesson("rag", trial.id, { sessionId, conditions: [{ provider: "changed", model: "changed", reasoning: "quick", style: "adaptive" }], completedTurns: 1, failedTurns: 0, durationMs: 2000 });
      store.submit("rag", trial.id, "post", submission); time = new Date(time.getTime() + 72 * 3600000); store.openRetention("rag", trial.id); store.submit("rag", trial.id, "delayed", submission);
      const recorded = store.get("rag", trial.id), exported = { version: 1, exportedAt: time.toISOString(), topicId: "rag", assignment: "randomized", trials: [recorded] };
      const report = inspectTeachingStudy(registry, [exported]);
      expect(report).toMatchObject({ randomized: 4, observed: 1, missing: 3 });
      const arm = report.arms.find(a => a.mode === ticket.assignment.mode)!;
      const score = recorded.results.delayed!.correctCount;
      expect(arm.primaryBounds).toEqual([score / arm.assigned, (score + 3 * arm.missing) / arm.assigned]);
      expect(arm.perProtocol.count).toBe(0);
      expect(report.records[0]!.deviations).toEqual(expect.arrayContaining(["assisted", "changed_conditions"]));
      expect(arm.primaryEstimate).toBe(missingRule === "zero_imputation" || arm.missing === 0 ? score / arm.assigned : null);
      const forged = structuredClone(exported); delete forged.trials[0]!.study; forged.assignment = "learner_selected";
      expect(() => inspectTeachingStudy(registry, [forged])).toThrow("study_assignment_mismatch");
      const relabeled = structuredClone(exported); relabeled.assignment = "learner_selected";
      expect(() => inspectTeachingStudy(registry, [relabeled])).toThrow("outcome_assignment_label_invalid");
    } finally { db.close(); }
  }
});
it("runs actual create/ticket/report CLIs with an immutable private registry and no fabricated observations", async () => {
  const fs = await import("node:fs/promises"), path = await import("node:path"), os = await import("node:os"), { execFile } = await import("node:child_process"), { promisify } = await import("node:util");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "study-cli-")), file = (name: string) => path.join(root, `${name}.json`);
  const run = (...args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/teaching-study.ts", ...args], { timeout: 10000 });
  try {
    await fs.writeFile(file("plan"), JSON.stringify(plan)); await fs.writeFile(file("roster"), JSON.stringify(["P001", "P002", "P003", "P004"]));
    await run("create", `--plan=${file("plan")}`, `--participants=${file("roster")}`, `--output=${file("registry")}`);
    await expect(run("create", `--plan=${file("plan")}`, `--participants=${file("roster")}`, `--output=${file("registry")}`)).rejects.toMatchObject({ code: 1 });
    await run("ticket", `--registry=${file("registry")}`, "--participant=P001", `--output=${file("ticket")}`);
    const ticket = validateStudyTicket(JSON.parse(await fs.readFile(file("ticket"), "utf8"))); expect(ticket.assignment.participantCode).toBe("P001");
    expect(await fs.readFile(file("ticket"), "utf8")).not.toContain("P002");
    await run("report", `--registry=${file("registry")}`, `--output=${file("report")}`);
    expect(JSON.parse(await fs.readFile(file("report"), "utf8"))).toMatchObject({ randomized: 4, observed: 0, missing: 4 });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
