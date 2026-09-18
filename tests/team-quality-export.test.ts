import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { expect, it } from "vitest";
import { sourceHash } from "../src/source-version.js";
import { teamExpandedCases } from "../src/team-expanded-cases.js";
import { exportTeamQuality } from "../src/team-quality-export.js";
const fixture = () => ({ version: 7, suite: "expanded", startedAt: new Date(0).toISOString(), datasetHash: sourceHash(JSON.stringify([teamExpandedCases[0]])), selection: { caseIds: ["X01"], repetitions: 1 }, rows: [{ caseId: "X01", repeat: 1, arm: "same-team", completed: true, attempted: true, text: '{"explanation":"这是用于导出测试的解释，不能宣称质量已经通过。"}', turns: [], requests: [] }] });
it("exports exact answers and pending reviews, preserving the source report hash and unavailable stages", () => {
  const original = fixture(); const result = exportTeamQuality(original, "final");
  expect(result.expectedResults).toBe(4); expect(result.results).toHaveLength(4);
  expect(result.results.find(row => row.provider === "same-team")).toMatchObject({ text: original.rows[0]!.text, review: "pending_human_review", criteria: teamExpandedCases[0]!.explanationCriteria });
  expect(result.results.filter(row => !row.attempted)).toHaveLength(3);
  expect(result.conditions?.sourceReportHash).toBe(sourceHash(JSON.stringify(original)));
  expect(exportTeamQuality(original, "member-1").results.every(row => row.status === "unavailable" && !row.attempted)).toBe(true);
  expect(() => exportTeamQuality({ ...original, datasetHash: "a".repeat(64) }, "final")).toThrow("team_export_dataset_mismatch");
  expect(() => exportTeamQuality({ ...original, rows: [...original.rows, ...original.rows] }, "final")).toThrow("team_export_duplicate");
});
it("exports and summarizes a real CLI artifact without overwriting previous evidence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "team-quality-export-"));
  try {
    const input = path.join(root, "team.json"), output = path.join(root, "quality.json"); await fs.writeFile(input, JSON.stringify(fixture()));
    const args = ["--import", "tsx", "scripts/export-team-quality.ts", `--report=${input}`, `--output=${output}`, "--stage=final"];
    await promisify(execFile)(process.execPath, args, { timeout: 10_000 });
    const summary = await promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/review-agent-quality.ts", `--report=${output}`], { timeout: 10_000 });
    expect(JSON.parse(summary.stdout)).toMatchObject({ planned: 4, attempted: 1, unreviewed: 1, dimensionReview: { reviewed: 0 } });
    await expect(promisify(execFile)(process.execPath, args, { timeout: 10_000 })).rejects.toMatchObject({ code: 1 });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
