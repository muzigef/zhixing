/** Synthetic protocol smoke. Model replies and scripted submissions are never learner-effect evidence. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { LearningApplication } from "../src/learning-application.js";
import { PiApplicationClient } from "../src/pi-application-client.js";
import { DesktopStore } from "../desktop/core/store.js";
import { DesktopService } from "../desktop/core/service.js";
import { resolvePackagedPiSdk } from "../desktop/core/pi-runner.js";

if (!process.argv.includes("--live")) throw new Error("explicit_live_flag_required");
if (process.env.ZHIXING_ALLOW_LIVE_PROVIDER === "0") throw new Error("live_provider_disabled");
const outputArg = process.argv.find(arg => arg.startsWith("--output="))?.slice(9);
if (!outputArg) throw new Error("explicit_output_required");
const root = process.cwd(); const output = path.resolve(outputArg);
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-outcomes-live-"));
const report: { version: number; syntheticOnly: true; startedAt: string; results: unknown[] } = { version: 1, syntheticOnly: true, startedAt: new Date().toISOString(), results: [] };
try {
  const pi = new PiApplicationClient({ projectDir: root, executable: process.execPath, sdk: await resolvePackagedPiSdk(path.join(root, "desktop")), worker: path.join(root, "desktop/build/runtime/pi-model-worker.mjs") });
  for (const mode of ["direct", "zhixing"] as const) {
    const app = await LearningApplication.open(path.join(temporary, mode, "workspace"), root);
    const service = new DesktopService(new DesktopStore(path.join(temporary, mode, "chats")), () => pi, app);
    try {
      const trial = app.outcomes.start("agent-development", mode);
      app.outcomes.submit("agent-development", trial.id, "pre", { answers: [-1, -1, -1], explanation: "合成测试作答，不代表真实学习者。", assistance: "solution" });
      const session = await service.openOutcomeLesson("agent-development", trial.id);
      await service.send({ sessionId: session.id, text: "请帮助我学习本次目标，先从核心概念开始。首轮控制在 250 字以内。", provider: "pi-codex", style: "adaptive", reasoning: "balanced" });
      await service.idle();
      const message = (await service.load(session.id)).messages.at(-1)!;
      const post = message.status === "completed" ? await service.finishOutcomeLesson("agent-development", trial.id) : undefined;
      report.results.push({ mode, status: message.status, text: message.text, error: message.error, model: message.model, reasoning: message.reasoning, durationMs: message.durationMs, firstTokenMs: message.firstTokenMs, usage: message.usage, toolCalls: message.timings?.toolCalls, nextStage: post?.stage, lesson: post?.lesson });
      await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
      console.log(JSON.stringify({ mode, status: message.status, model: message.model, durationMs: message.durationMs, nextStage: post?.stage }));
      if (message.status !== "completed" || post?.stage !== "post") throw new Error("live_outcome_smoke_failed");
    } finally { service.stop(); await service.idle(); await service.pauseMaintenance(); app.close(); }
  }
} finally { await fs.rm(temporary, { recursive: true, force: true }); }
