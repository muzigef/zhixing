import { _electron as electron } from "playwright";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
if (!process.argv.includes("--live")) throw new Error("Explicit --live is required; this fixed synthetic evaluation makes real model requests.");
if (process.env.ZHIXING_ALLOW_LIVE_PROVIDER === "0") throw new Error("Live provider requests are disabled; no override was made.");
const suite = process.argv.find(value => value.startsWith("--suite="))?.slice(8) ?? "pilot";
if (!["pilot", "holdout", "regression", "quality", "expanded"].includes(suite)) throw new Error("Unsupported suite.");
const caseIds = process.argv.find(value => value.startsWith("--cases="))?.slice(8).split(",");
const repetitions = Number(process.argv.find(value => value.startsWith("--repetitions="))?.slice(14) ?? (suite === "holdout" ? "2" : "1"));
if (![1, 2].includes(repetitions) || (caseIds && (!caseIds.length || caseIds.length > 16 || new Set(caseIds).size !== caseIds.length || caseIds.some(id => !/^[DHQX][0-9]{2}$/.test(id))))) throw new Error("Invalid bounded case selection.");
const leadProvider = process.argv.find(value => value.startsWith("--lead="))?.slice(7) ?? "pi-codex";
if (!["pi-codex", "native-codex"].includes(leadProvider)) throw new Error("Unsupported lead provider.");
const executable = process.env.ZHIXING_DESKTOP_EXECUTABLE ?? path.join(os.homedir(), "Applications/知行.app/Contents/MacOS/知行");
const root = path.resolve(import.meta.dirname, "../..");
const sourceHash = createHash("sha256").update(await fs.readFile(path.join(root, suite === "expanded" ? "src/team-expanded-cases.ts" : suite === "quality" ? "src/team-quality-cases.ts" : "src/team-evaluation-cases.ts"))).digest("hex");
const bundlePath = path.resolve(path.dirname(executable), "../Resources/app.asar");
const appBundleHash = createHash("sha256").update(await fs.readFile(bundlePath)).digest("hex");
const environment = { ...process.env, ZHIXING_DESKTOP_EVALUATION: "1" };
delete environment.ZHIXING_DESKTOP_TEST_DATA; delete environment.ZHIXING_DESKTOP_LIVE_CHECK;
const app = await electron.launch({ executablePath: executable, args: [], env: environment, timeout: 30_000 });
let timer;
const preflight = [];
try {
  const page = await app.firstWindow(); await page.getByRole("button", { name: "发送消息", exact: true }).waitFor();
  const ready = await page.evaluate(async leadProvider => {
    const value = await window.zhixing.invoke({ type: "boot" }); if (!value.ok) return { ready: false };
    const native = leadProvider === "native-codex" ? await window.zhixing.invoke({ type: "native-agent-status" }) : undefined;
    const leadReady = leadProvider === "native-codex" ? native?.ok && native.data.some(item => item.vendor === "codex" && item.available) : value.data.model.configured;
    return { ready: !value.data.activeSessionId && leadReady && value.data.api.configured && value.data.kimiApi.configured, leadProvider, leadModel: leadProvider === "native-codex" ? value.data.settings.nativeCodexModel ?? "gpt-6-astra" : value.data.model.model, deepseek: value.data.api.model, kimi: value.data.kimiApi.model };
  }, leadProvider);
  console.log(JSON.stringify({ suite, ...ready })); if (!ready.ready) throw new Error("All three configured providers and an idle app are required.");
  if (process.argv.includes("--preflight")) for (const provider of ["deepseek-api", "kimi-api"]) {
    const result = await page.evaluate(provider => window.zhixing.invoke({ type: "check-api", provider }), provider);
    preflight.push({ provider, ...result }); console.log(JSON.stringify({ preflight: preflight.at(-1) }));
    if (!result.ok) throw new Error("Connection preflight failed; quality evaluation has not started.");
  }
  timer = setInterval(() => { void page.evaluate(() => window.zhixing.invoke({ type: "team-evaluation-status" })).then(result => console.log(JSON.stringify(result.ok ? result.data : { statusUnavailable: true }))).catch(() => console.log("evaluation_status_unavailable")); }, 20_000);
  const result = await page.evaluate(({ suite, leadProvider, caseIds, repetitions }) => window.zhixing.invoke({ type: "team-evaluate", suite, leadProvider, caseIds, repetitions }), { suite, leadProvider, caseIds, repetitions });
  if (!result.ok) throw new Error(result.error);
  if (createHash("sha256").update(await fs.readFile(bundlePath)).digest("hex") !== appBundleHash) throw new Error("Evaluation bundle changed during the run.");
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, "");
  const file = path.join(root, "docs/evidence", `team-evaluation-${leadProvider}-${suite}-${timestamp}.json`);
  await fs.writeFile(file, JSON.stringify({ ...result.data, connectionPreflight: preflight, evaluatorSourceHash: sourceHash, appBundleHash, isolatedWorkspace: true }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ artifact: file, planned: result.data.planned, completedRows: result.data.rows.length, summary: result.data.summary, comparisons: result.data.pairedComparisons }));
} catch (error) {
  const timestamp = new Date().toISOString().replace(/[^0-9]/g, "");
  const file = path.join(root, "docs/evidence", `team-evaluation-failed-${timestamp}.json`);
  await fs.writeFile(file, JSON.stringify({ version: 1, status: "failed", suite, leadProvider, caseIds, repetitions, connectionPreflight: preflight, evaluatorSourceHash: sourceHash, appBundleHash, isolatedWorkspace: true, qualityRunCompleted: false }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  console.log(JSON.stringify({ failureArtifact: file })); throw error;
} finally {
  clearInterval(timer);
  const closeTimer = setTimeout(() => app.process().kill("SIGTERM"), 10_000);
  const forceCloseTimer = setTimeout(() => app.process().kill("SIGKILL"), 15_000);
  try { await app.close(); } finally { clearTimeout(closeTimer); clearTimeout(forceCloseTimer); }
}
