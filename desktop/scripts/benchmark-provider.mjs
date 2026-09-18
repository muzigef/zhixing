import { _electron as electron } from "playwright";
import path from "node:path";
import os from "node:os";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const provider = arg("provider") ?? "native-codex", cycles = Number(arg("cycles") ?? "2");
if (!process.argv.includes("--live") || process.env.ZHIXING_ALLOW_LIVE_PROVIDER === "0") throw new Error("explicit_live_provider_required");
if (!["native-codex", "pi-codex", "deepseek-api", "kimi-api", "demo"].includes(provider) || ![1, 2, 3].includes(cycles)) throw new Error("benchmark_selection_invalid");
const root = path.resolve(import.meta.dirname, "../.."), output = arg("output") ?? path.join(root, "docs/evidence", `provider-performance-${provider}-${Date.now()}.json`);
const executable = process.env.ZHIXING_DESKTOP_EXECUTABLE ?? path.join(os.homedir(), "Applications/知行.app/Contents/MacOS/知行");
const bundle = path.resolve(path.dirname(executable), "../Resources/app.asar"), hash = async () => createHash("sha256").update(await fs.readFile(bundle)).digest("hex"), appBundleHash = await hash();
// Reserve the output before any live requests. Never overwrite an existing report.
const { writeEvaluationJson } = await import("../../scripts/evaluation-json.mjs");
await writeEvaluationJson(output, { status: "starting", provider, cycles, appBundleHash, isolatedWorkspace: true });
const environment = { ...process.env, ZHIXING_DESKTOP_EVALUATION: "1" }; delete environment.ZHIXING_DESKTOP_TEST_DATA; delete environment.ZHIXING_DESKTOP_LIVE_CHECK;
const app = await electron.launch({ executablePath: executable, args: [], env: environment, timeout: 30_000 });
try {
  const page = await app.firstWindow(); await page.getByRole("button", { name: "发送消息", exact: true }).waitFor();
  const result = await page.evaluate(({ provider, cycles }) => window.zhixing.invoke({ type: "provider-benchmark", provider, cycles }), { provider, cycles });
  if (!result.ok) throw new Error("benchmark_application_failed");
  if (await hash() !== appBundleHash) throw new Error("benchmark_bundle_changed");
  await fs.writeFile(output, JSON.stringify({ ...result.data, appBundleHash, isolatedWorkspace: true }, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ output, planned: result.data.planned, summary: result.data.summary }));
  if (result.data.rows.some(row => !row.completed)) process.exitCode = 1;
} catch (error) {
  await fs.writeFile(output, JSON.stringify({ status: "failed", provider, cycles, appBundleHash, isolatedWorkspace: true, qualityClaim: false }) + "\n", { mode: 0o600 });
  throw error;
} finally {
  const timer = setTimeout(() => app.process().kill("SIGTERM"), 10_000), force = setTimeout(() => app.process().kill("SIGKILL"), 15_000);
  try { await app.close(); } finally { clearTimeout(timer); clearTimeout(force); }
}
