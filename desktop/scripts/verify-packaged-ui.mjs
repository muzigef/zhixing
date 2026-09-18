import { spawn } from "node:child_process";
import path from "node:path";
import { packageIdentity } from "./package-identity.mjs";
import { packagedUIGroups } from "./release-policy.mjs";
import { writeEvaluationJson } from "../../scripts/evaluation-json.mjs";
const args = process.argv.slice(2), output = args.find(arg => arg.startsWith("--output="))?.slice(9);
if (args.length !== 1 || !output) throw new Error("usage: --output=new-ui-receipt.json");
const executable = process.env.ZHIXING_DESKTOP_EXECUTABLE, before = await packageIdentity(executable);
const receipt = { version: 1, at: new Date().toISOString(), platform: before.platform, arch: before.arch, packaged: true, identity: before.identity, groups: [], passed: false, reason: "" };
const root = path.resolve(import.meta.dirname, "..");
async function run(group) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(root, "scripts", `${group}.mjs`)], { cwd: root, env: { ...process.env, ZHIXING_DESKTOP_EXECUTABLE: executable, ZHIXING_DESKTOP_DEV: "", ZHIXING_ALLOW_LIVE_PROVIDER: "0" }, stdio: "inherit" });
    const timer = setTimeout(() => child.kill("SIGKILL"), 180000);
    child.once("error", () => { clearTimeout(timer); resolve(false); });
    child.once("exit", code => { clearTimeout(timer); resolve(code === 0); });
  });
}
try {
  for (const group of packagedUIGroups) {
    if (!await run(group)) throw new Error("packaged_ui_group_failed");
    receipt.groups.push(group);
  }
  if (JSON.stringify((await packageIdentity(executable)).identity) !== JSON.stringify(before.identity)) throw new Error("packaged_ui_build_changed");
  receipt.passed = true;
} catch (error) { receipt.reason = error instanceof Error && /^packaged_ui_[a-z_]+$/.test(error.message) ? error.message : "packaged_ui_failed"; }
await writeEvaluationJson(output, receipt);
console.log(JSON.stringify({ packaged: true, passed: receipt.passed, completedGroups: receipt.groups.length }));
if (!receipt.passed) process.exitCode = 1;
