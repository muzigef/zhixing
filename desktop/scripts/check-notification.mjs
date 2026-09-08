import { _electron as electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
if (!process.argv.includes("--native")) throw new Error("Pass --native to display one synthetic system reminder.");
const root = path.resolve(import.meta.dirname, "..");
const data = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-notification-"));
const executablePath = process.env.ZHIXING_DESKTOP_EXECUTABLE;
const app = await electron.launch({ ...(executablePath ? { executablePath } : {}), args: executablePath ? [] : [root], env: { ...process.env, ZHIXING_DESKTOP_TEST_DATA: data, ZHIXING_DESKTOP_LIVE_CHECK: "0", ZHIXING_ALLOW_LIVE_PROVIDER: "0", PI_CODING_AGENT_DIR: path.join(data, "pi") }, timeout: 30000 });
try {
  const page = await app.firstWindow(); await page.getByRole("button", { name: "发送消息", exact: true }).waitFor();
  await app.evaluate(({ Notification }) => {
    globalThis.zhixingNotificationProbe = { supported: Notification.isSupported(), calls: 0, events: [], errors: [], notifications: [] };
    const show = Notification.prototype.show;
    Notification.prototype.show = function () {
      globalThis.zhixingNotificationProbe.calls++; globalThis.zhixingNotificationProbe.notifications.push(this);
      this.on("show", () => globalThis.zhixingNotificationProbe.events.push("show"));
      this.on("failed", (_event, error) => { globalThis.zhixingNotificationProbe.events.push("failed"); globalThis.zhixingNotificationProbe.errors.push(String(error).slice(0, 1000)); });
      return show.call(this);
    };
  });
  await page.evaluate(async () => {
    const now = new Date(), time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const result = await window.zhixing.invoke({ type: "reminder-save", topicId: "rag", time, enabled: true });
    if (!result.ok) throw new Error(result.error);
  });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize());
  const end = Date.now() + 35000; let result;
  while (Date.now() < end) {
    result = await app.evaluate(() => { const p = globalThis.zhixingNotificationProbe; return { supported: p.supported, calls: p.calls, events: p.events, errors: p.errors }; });
    if (result.events.length) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  console.log(JSON.stringify({ syntheticOnly: true, ...result, passed: result.events.includes("show"), interpretation: "Actual shared scheduler and native Notification.show; show event is OS delivery observation, visual appearance depends on OS notification settings." }));
  if (!result.events.includes("show")) process.exitCode = 1;
} finally {
  await app.evaluate(() => { for (const notification of globalThis.zhixingNotificationProbe?.notifications ?? []) notification.close(); });
  await app.close(); await fs.rm(data, { recursive: true, force: true });
}
