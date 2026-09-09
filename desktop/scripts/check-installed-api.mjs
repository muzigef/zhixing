import { _electron as electron } from "playwright";
import path from "node:path";
import os from "node:os";
// Explicit real-account probe through the installed app's IPC; no credential reads here.
if (!process.argv.includes("--live")) throw new Error("Explicit --live is required.");
const provider = process.argv.find(value => value.startsWith("--provider="))?.slice(11) ?? "kimi-api";
if (!["kimi-api", "deepseek-api"].includes(provider)) throw new Error("Unsupported built-in provider.");
const executable = process.env.ZHIXING_DESKTOP_EXECUTABLE ?? path.join(os.homedir(), "Applications/知行.app/Contents/MacOS/知行");
const environment = { ...process.env, ZHIXING_ALLOW_LIVE_PROVIDER: "1" };
delete environment.ZHIXING_DESKTOP_TEST_DATA;
delete environment.ZHIXING_DESKTOP_LIVE_CHECK;
const app = await electron.launch({ executablePath: executable, args: [], env: environment, timeout: 30_000 });
try {
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "发送消息", exact: true }).waitFor();
  const configuration = await page.evaluate(async provider => {
    const result = await window.zhixing.invoke({ type: "boot" });
    if (!result.ok) return { error: result.error };
    const api = provider === "kimi-api" ? result.data.kimiApi : result.data.api;
    return { configured: api?.configured ?? false, source: api?.source, model: api?.model, busy: Boolean(result.data.activeSessionId) };
  }, provider);
  console.log(JSON.stringify({ provider, ...configuration }));
  if (!configuration.configured || configuration.busy || configuration.error) process.exitCode = 1;
  else {
    const result = await page.evaluate(async provider => await window.zhixing.invoke({ type: "check-api", provider }), provider);
    console.log(JSON.stringify({ provider, ...result }));
    if (!result.ok) process.exitCode = 1;
  }
} finally { await app.close(); }
