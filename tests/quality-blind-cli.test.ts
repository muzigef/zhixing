import { expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { evaluateQuality } from "../src/quality-evaluation.js";
it("creates, imports, compares and calibrates through actual CLI processes, refusing overwrites and protected paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "blind-cli-"));
  const run = (...args: string[]) => promisify(execFile)(process.execPath, ["--import", "tsx", "scripts/review-quality-blind.ts", ...args], { timeout: 10_000 });
  try {
    const report = await evaluateQuality([{ id: "A", prompt: "解释", criteria: ["正确"] }], ["demo"], 1, async () => ({ status: "completed", text: "两个加两个，共四个。" }));
    const reportPath = path.join(root, "report.json"), output = path.join(root, "pack"); await fs.writeFile(reportPath, JSON.stringify(report));
    const common = `--report=${reportPath}`;
    await run("create", common, `--output=${output}`);
    const packet = JSON.parse(await fs.readFile(path.join(output, "reviewer.json"), "utf8")), mapping = JSON.parse(await fs.readFile(path.join(output, "coordinator-private.json"), "utf8"));
    for (const name of ["a", "b"]) {
      const d = { score: name === "a" ? 4 : 3, rationale: "合成评分", quotes: ["共四个"] };
      const response = { version: 1, packetHash: mapping.packetHash, reviewer: { name, kind: "development_assistant", independent: false }, ratings: [{ itemId: packet.items[0].id, criteria: ["pass"], dimensions: { correctness: d, completeness: d, clarity: d }, rationale: "合成夹具", failures: [] }] };
      const responseFile = path.join(root, `response-${name}.json`); await fs.writeFile(responseFile, JSON.stringify(response));
      await run("import", common, `--packet=${path.join(output, "reviewer.json")}`, `--coordinator=${path.join(output, "coordinator-private.json")}`, `--response=${responseFile}`, `--output=${path.join(root, `${name}.json`)}`);
    }
    const comparison = path.join(root, "comparison.json");
    await run("compare", common, `--a=${path.join(root, "a.json")}`, `--b=${path.join(root, "b.json")}`, `--output=${comparison}`);
    expect(JSON.parse(await fs.readFile(comparison, "utf8"))).toMatchObject({ pairedItems: 1, dimensions: { clarity: { meanDifferenceBMinusA: -1 } } });
    await run("calibrate", common, `--reference=${path.join(root, "a.json")}`, `--reviews=${path.join(root, "b.json")}`, `--output=${path.join(root, "calibration.json")}`);
    expect(JSON.parse(await fs.readFile(path.join(root, "calibration.json"), "utf8"))).toMatchObject({ purpose: "reference_comparison_only", automaticCertification: false });
    await expect(run("create", common, `--output=${output}`)).rejects.toMatchObject({ code: 1 });
    await expect(run("create", common, `--output=${path.join(root, ".codex")}`)).rejects.toMatchObject({ code: 1 });
    await expect(fs.stat(path.join(root, ".codex"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
