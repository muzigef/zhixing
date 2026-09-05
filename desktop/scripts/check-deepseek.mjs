import { _electron as electron } from "playwright";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
const root = path.resolve(import.meta.dirname, "..");
const data = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-api-check-"));
const live = process.argv.includes("--live");
const app = await electron.launch({
  args: [root],
  env: {
    ...process.env,
    ZHIXING_DESKTOP_TEST_DATA: data,
    ZHIXING_DESKTOP_LIVE_CHECK: "1",
    PI_CODING_AGENT_DIR: path.join(data, "pi"),
    ZHIXING_ALLOW_LIVE_PROVIDER: live ? "1" : "0",
  },
  timeout: 30_000,
});
try {
  const page = await app.firstWindow();
  await page.getByRole("button", { name: "发送消息", exact: true }).waitFor();
  const state = await page.evaluate(async () => {
    const result = await window.zhixing.invoke({ type: "boot" });
    if (!result.ok) throw new Error(result.error);
    return result.data;
  });
  console.log(
    JSON.stringify({
      configured: state.api.configured,
      source: state.api.source,
      model: state.api.model,
    }),
  );
  if (live && state.api.configured) {
    const result = await page.evaluate(async () => {
      const created = await window.zhixing.invoke({ type: "new" });
      if (!created.ok) throw new Error(created.error);
      const id = created.data.id;
      await window.zhixing.invoke({
        type: "send",
        sessionId: id,
        provider: "deepseek-api",
        style: "concise",
        text: "2+2 等于几？只回复一个数字。",
      });
      return await new Promise((resolve) => {
        const stop = window.zhixing.subscribe((event) => {
          if (
            event.type === "session" &&
            event.session.id === id &&
            event.session.messages.at(-1)?.status !== "running"
          ) {
            stop();
            const message = event.session.messages.at(-1);
            resolve({
              status: message.status,
              text: message.text,
              error: message.error,
              durationMs: message.durationMs,
              firstTokenMs: message.firstTokenMs,
            });
          }
        });
      });
    });
    console.log(JSON.stringify(result));
    if (result.status !== "completed") process.exitCode = 1;
  }
} finally {
  await app.close();
  await fs.rm(data, { recursive: true, force: true });
}
