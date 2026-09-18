import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { writeEvaluationJson } from "../../scripts/evaluation-json.mjs";
const args = process.argv.slice(2), output = args.find(arg => arg.startsWith("--output="))?.slice(9), deny = args.includes("--expect-basic-denied");
if (!output || args.some(arg => !arg.startsWith("--output=") && arg !== "--expect-basic-denied")) throw new Error("usage: --output=new-receipt.json [--expect-basic-denied]");
const root = path.resolve(import.meta.dirname, ".."), data = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-native-secret-"));
const executable = process.env.ZHIXING_DESKTOP_EXECUTABLE ?? (await import("electron")).default;
const baseArgs = process.env.ZHIXING_DESKTOP_EXECUTABLE ? [] : [root];
const keys = ["PATH", "HOME", "TMPDIR", "TMP", "TEMP", "USERPROFILE", "LOCALAPPDATA", "APPDATA", "SystemRoot", "SYSTEMROOT", "XDG_RUNTIME_DIR", "XDG_CONFIG_HOME", "XDG_CURRENT_DESKTOP", "DBUS_SESSION_BUS_ADDRESS", "GNOME_KEYRING_CONTROL", "DISPLAY", "WAYLAND_DISPLAY", "LANG", "LC_ALL"];
const environment = Object.fromEntries(keys.filter(key => process.env[key]).map(key => [key, process.env[key]]));
const report = { version: 1, platform: process.platform, arch: process.arch, stages: [], passed: false, reason: "" };
async function run(stage) {
  return new Promise(resolve => {
    const child = spawn(executable, [...baseArgs, ...(deny ? ["--password-store=basic"] : [])], { cwd: root, env: { ...environment, ZHIXING_SECURE_STORE_PROBE: stage, ZHIXING_DESKTOP_TEST_DATA: data, ZHIXING_ALLOW_LIVE_PROVIDER: "0" }, stdio: "ignore" });
    let timedOut = false, kill;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); kill = setTimeout(() => child.kill("SIGKILL"), 5000); }, 45000);
    child.once("error", () => { clearTimeout(timer); clearTimeout(kill); resolve({ code: 1, timedOut, spawnFailed: true }); });
    child.once("exit", code => { clearTimeout(timer); clearTimeout(kill); resolve({ code, timedOut }); });
  });
}
try {
  for (const stage of deny ? ["deny"] : ["create", "restart"]) {
    const execution = await run(stage);
    let receipt; try { receipt = JSON.parse(await fs.readFile(path.join(data, `native-${stage}.json`), "utf8")); } catch { /* Preserve the timeout/failure even if initialization never completed. */ }
    report.stages.push({ stage, execution, ...(receipt ? { receipt } : {}) });
    if (execution.code !== 0 || !receipt?.passed) { report.reason = execution.timedOut ? "native_probe_timeout" : "native_probe_failed"; break; }
  }
  report.passed = report.stages.length === (deny ? 1 : 2) && report.stages.every(s => s.execution.code === 0 && s.receipt?.passed);
  await writeEvaluationJson(output, report);
  console.log(JSON.stringify({ platform: report.platform, passed: report.passed, stages: report.stages.length, reason: report.reason }));
  if (!report.passed) process.exitCode = 1;
} finally { await fs.rm(data, { recursive: true, force: true }); }
