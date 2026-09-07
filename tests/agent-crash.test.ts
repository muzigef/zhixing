import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { AgentService } from "../src/agent-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { AgentExecutionStore } from "../src/agent-execution-store.js";
import { LearningApplication } from "../src/learning-application.js";
import type { ContinuableModelClient } from "../src/model.js";

it.each(["turn_validated", "side_effect", "tool_completed"])("recovers the canonical execution after SIGKILL at %s without duplicate artifacts", async boundary => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-journal-crash-")); const app = await LearningApplication.open(root, process.cwd());
  const store = new AgentSessionStore(path.join(root, "chats")); const session = await store.create();
  let child: ReturnType<typeof fork> | undefined;
  try {
    await app.handle("开始第 1 天", "agent-development");
    child = fork(fileURLToPath(new URL("./fixtures/agent-crash-process.ts", import.meta.url)), [root, session.id, boundary], { execArgv: ["--import", "tsx"], stdio: ["ignore", "ignore", "ignore", "ipc"], env: { ...process.env, ZHIXING_ALLOW_LIVE_PROVIDER: "0" } });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("fixture_timeout")), 5000);
      child!.once("message", () => { clearTimeout(timer); resolve(); }); child!.once("exit", code => { clearTimeout(timer); reject(new Error(`fixture_early_exit:${code}`)); });
    });
    const killed = new Promise<void>(resolve => child!.once("exit", (_code, signal) => { expect(signal).toBe("SIGKILL"); resolve(); })); child.kill("SIGKILL"); await killed;
    const before = (await store.load(session.id)).messages.at(-1)!;
    const journal = new AgentExecutionStore(app.database, { taskId: before.taskId!, sessionId: session.id, topicId: "agent-development" });
    expect(journal.read()?.pending?.next).toBe(boundary === "tool_completed" ? 1 : 0);
    let streams = 0;
    const client: ContinuableModelClient = { async *stream() { streams++; throw new Error("must restore pending calls"); yield { type: "done" }; }, async *continue(_prompt, results) { expect(results).toHaveLength(2); yield { type: "text_delta", text: "两份均已保存。" }; yield { type: "done" }; } };
    const service = new AgentService(store, () => client, app);
    await service.send({ sessionId: session.id, text: "继续", provider: "deepseek-api", style: "adaptive", resumeTaskId: before.taskId }); await service.idle();
    expect((await store.load(session.id)).messages.at(-1)?.status).toBe("completed"); expect(streams).toBe(0);
    expect((await app.evidence.list("agent-development", "D01")).artifacts).toHaveLength(2);
    expect(journal.read()?.status).toBe("completed");
  } finally { if (child && child.exitCode === null && !child.killed) child.kill("SIGKILL"); app.close(); await fs.rm(root, { recursive: true, force: true }); }
});
