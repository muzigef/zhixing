import { expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { teamExpandedCases } from "../src/team-expanded-cases.js";
import { evaluateTeams } from "../src/team-evaluation.js";
import { teamEvaluationSelectionSchema } from "../src/team-evaluation-contracts.js";
import { desktopCommandSchema } from "../desktop/core/contracts.js";
import type { ModelClient } from "../src/model.js";
import { fixtureTeamReport, fixtureTeamReview } from "./team-fixtures.js";

it("checks new numerical oracles using executions, enumeration and independent calculations", () => {
  const oracle = (id: string) => teamExpandedCases.find(item => item.id === id)!.expected;
  expect(new Set(teamExpandedCases.map(item => item.id)).size).toBe(12);
  const hits = new Set(["A", "A", "B"].filter(id => ["A", "B", "C"].includes(id))).size;
  expect(oracle("X01")).toMatchObject({ recallAt3: hits / 3, precisionAt3: hits / 3 });
  const db = new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE account(balance INTEGER); INSERT INTO account VALUES(100); CREATE TABLE reservation(amount INTEGER)");
    for (let i = 0; i < 2; i++) { db.exec("BEGIN"); const change = db.prepare("UPDATE account SET balance=balance-80 WHERE balance>=80").run(); if (change.changes === 1) db.exec("INSERT INTO reservation VALUES(80)"); db.exec("COMMIT"); }
    expect(oracle("X05")).toMatchObject({ finalBalance: db.prepare("SELECT balance AS n FROM account").get()!.n, reservedTotal: db.prepare("SELECT SUM(amount) AS n FROM reservation").get()!.n });
  } finally { db.close(); }
  const schedules = [["A", "B", "C"], ["B", "A", "C"]].map(order => order.reduce((sum, id) => sum + (id === "C" ? 1 : 4), 0));
  expect(oracle("X06").minimumTimeWithOneWorker).toBe(Math.min(...schedules));
  let single = 0, joint = 0;
  for (const stale of [false, true]) for (const a of [false, true]) for (const b of [false, true]) {
    const p = (stale ? .2 : .8) * (a ? .1 : .9) * (b ? .1 : .9);
    if (stale || a) single += p; if ((stale || a) && (stale || b)) joint += p;
  }
  expect(oracle("X09").singleError).toBeCloseTo(single, 14); expect(oracle("X09").bothWrong).toBeCloseTo(joint, 14);
  expect(oracle("X09").secondWrongGivenFirstWrong).toBeCloseTo(joint / single, 14);
  const brier = (predictions: number[]) => predictions.reduce((sum, p, i) => sum + (p - [1, 0][i]!) ** 2, 0) / predictions.length;
  expect(oracle("X11").brierA).toBeCloseTo(brier([.9, .8]), 14); expect(oracle("X11").brierB).toBeCloseTo(brier([.6, .4]), 14);
});
it("validates bounded selectors before touching providers and shares them with desktop IPC", async () => {
  expect(teamEvaluationSelectionSchema.safeParse({ suite: "expanded", caseIds: ["X01", "X01"] }).success).toBe(false);
  expect(teamEvaluationSelectionSchema.safeParse({ suite: "expanded", repetitions: 3 }).success).toBe(false);
  expect(desktopCommandSchema.safeParse({ type: "team-evaluate", suite: "expanded", caseIds: ["X01"], repetitions: 2 }).success).toBe(true);
  let resolutions = 0;
  await expect(evaluateTeams({ root: "unused", suite: "expanded", caseIds: ["H01"], resolve() { resolutions++; throw new Error("unused"); }, signal: new AbortController().signal })).rejects.toThrow("team_evaluation_case_selection");
  expect(resolutions).toBe(0);
});
it("runs all four arms and pairs repeated cases without leaking answers or rubrics", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "expanded-team-")); const sent: string[] = [];
  const client: ModelClient = { async *stream(prompt, _signal, options) {
    sent.push(prompt, JSON.stringify(options?.messages)); const stage = options?.messages?.find(item => item.role === "system" && /^TEAM_/.test(item.content))?.content;
    yield { type: "text_delta", text: stage?.startsWith("TEAM_PLAN") ? '{"tasks":["计算","边界"]}' : stage?.startsWith("TEAM_MEMBER") ? fixtureTeamReport : stage?.startsWith("TEAM_REVIEW") ? fixtureTeamReview : '{"explanation":"本回答只验证评测流程，不代表真实模型质量。"}' };
    yield { type: "usage", usage: { inputTokens: 10, outputTokens: 20 } }; yield { type: "done" };
  } };
  try {
    const report = await evaluateTeams({ root, suite: "expanded", caseIds: ["X04"], repetitions: 2, resolve: provider => ({ ...client, identity: { provider, model: provider, connection: provider } }), signal: new AbortController().signal });
    expect(report.planned).toBe(8); expect(report.rows).toHaveLength(8);
    expect(report.pairedComparisons).toHaveLength(3); expect(report.pairedComparisons.every(pair => pair.pairs === 2 && pair.caseClusters === 1 && pair.confidenceInterval95 === null)).toBe(true);
    expect(report.selection).toEqual({ caseIds: ["X04"], repetitions: 2, datasetClassification: "author_written_development" });
    expect(sent.join("\n")).not.toContain(teamExpandedCases[3]!.explanationCriteria[0]);
    expect(report.rows.every(row => row.attempted)).toBe(true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
