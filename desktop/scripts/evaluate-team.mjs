import { _electron as electron } from "playwright";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
if (!process.argv.includes("--live")) throw new Error("Explicit --live is required; this fixed synthetic evaluation makes real model requests.");
if (process.env.ZHIXING_ALLOW_LIVE_PROVIDER === "0") throw new Error("Live provider requests are disabled; no override was made.");
const suite = process.argv.find(value => value.startsWith("--suite="))?.slice(8) ?? "pilot";
if (!["pilot", "holdout"].includes(suite)) throw new Error("Unsupported suite.");
const executable = process.env.ZHIXING_DESKTOP_EXECUTABLE ?? path.join(os.homedir(), "Applications/知行.app/Contents/MacOS/知行");
const environment = { ...process.env };
delete environment.ZHIXING_DESKTOP_TEST_DATA; delete environment.ZHIXING_DESKTOP_LIVE_CHECK;
const app = await electron.launch({ executablePath: executable, args: [], env: environment, timeout: 30_000 });
let timer;
try {
  const page = await app.firstWindow(); await page.getByRole("button", { name: "发送消息", exact: true }).waitFor();
  const ready = await page.evaluate(async () => {
    const value = await window.zhixing.invoke({ type: "boot" }); if (!value.ok) return { ready: false };
    return { ready: !value.data.activeSessionId && value.data.model.configured && value.data.api.configured && value.data.kimiApi.configured, pi: value.data.model.model, deepseek: value.data.api.model, kimi: value.data.kimiApi.model };
  });
  console.log(JSON.stringify({ suite, ...ready })); if (!ready.ready) throw new Error("All three configured providers and an idle app are required.");
  timer = setInterval(() => { void page.evaluate(() => window.zhixing.invoke({ type: "team-evaluation-status" })).then(result => console.log(JSON.stringify(result.ok ? result.data : { statusUnavailable: true }))).catch(() => console.log("evaluation_status_unavailable")); }, 20_000);
  const result = await page.evaluate(suite => window.zhixing.invoke({ type: "team-evaluate", suite }), suite);
  if (!result.ok) throw new Error(result.error);
  const root = path.resolve(import.meta.dirname, "../..");
  const sourceHash = createHash("sha256").update(await fs.readFile(path.join(root, "src/team-evaluation-cases.ts"))).digest("hex");
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, "");
  const file = path.join(root, "docs/evidence", `team-evaluation-${suite}-${timestamp}.json`);
  await fs.writeFile(file, JSON.stringify({ ...result.data, evaluatorSourceHash: sourceHash }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ artifact: file, planned: result.data.planned, completedRows: result.data.rows.length, summary: result.data.summary, comparisons: result.data.comparisons }));
} finally { clearInterval(timer); await app.close(); }
