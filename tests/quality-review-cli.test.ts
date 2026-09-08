import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { evaluateQuality } from "../src/quality-evaluation.js";
import { qualityReportHash } from "../src/quality-review.js";
it("imports a bound review through the real report CLI and refuses to overwrite output", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-review-cli-"));
  try {
    const report = await evaluateQuality([{ id: "H01", prompt: "合成题", criteria: ["检查"] }], ["demo"], 1, async () => ({ status: "completed", text: "合成回答" }));
    const reviews = { version: 1, reportHash: qualityReportHash(report), reviewer: { name: "合成夹具", kind: "development_assistant", independent: false }, scores: [{ provider: "demo", id: "H01", repetition: 1, criteria: ["pass"], rationale: "这是测试夹具，不是独立人工评分", failures: [] }] };
    await fs.writeFile(path.join(root, "report.json"), JSON.stringify(report)); await fs.writeFile(path.join(root, "reviews.json"), JSON.stringify(reviews));
    const args = ["--import", "tsx", "scripts/review-agent-quality.ts", `--report=${path.join(root, "report.json")}`, `--reviews=${path.join(root, "reviews.json")}`, `--output=${path.join(root, "summary.json")}`];
    const { stdout } = await promisify(execFile)(process.execPath, args, { cwd: process.cwd(), timeout: 10_000 });
    expect(JSON.parse(stdout)).toMatchObject({ reviewed: 1, passed: 1, independentHumanReviewed: 0 });
    await expect(promisify(execFile)(process.execPath, args, { cwd: process.cwd(), timeout: 10_000 })).rejects.toMatchObject({ code: 1 });
    expect(JSON.parse(await fs.readFile(path.join(root, "summary.json"), "utf8")).review.scores[0].verdict).toBe("pass");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
