/** Synthetic-only live acceptance. Credentials stay inside existing provider adapters. */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { AgentService } from "../src/agent-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { LearningApplication } from "../src/learning-application.js";
import { PiApplicationClient } from "../src/pi-application-client.js";
import { DeepSeekClient } from "../src/deepseek-client.js";
import { MacOSKeychainSecretStore } from "../src/macos-keychain.js";
import { resolvePackagedPiSdk } from "../desktop/core/pi-runner.js";
import type { ContinuableModelClient } from "../src/model.js";

if (!process.argv.includes("--live")) throw new Error("explicit_live_flag_required");
if (process.env.ZHIXING_ALLOW_LIVE_PROVIDER === "0") throw new Error("live_provider_disabled");
const project = process.cwd();
const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-p0-live-"));
const output = process.argv.find(value => value.startsWith("--output="))?.slice(9);
if (!output) throw new Error("explicit_output_required");
const reports: unknown[] = [];
try {
  for (const provider of ["pi-codex", "deepseek-api"] as const) {
    const started = Date.now(); const app = await LearningApplication.open(path.join(root, provider), project);
    const store = new AgentSessionStore(path.join(root, `${provider}-chats`));
    let streams = 0; let continuations = 0; let restoredTurns = 0; let nativeResults = 0;
    try {
      await app.handle("开始第 1 天", "agent-development");
      const makeClient = async (): Promise<ContinuableModelClient> => provider === "pi-codex"
        ? new PiApplicationClient({ projectDir: project, executable: process.execPath, worker: path.join(project, "desktop/build/runtime/pi-model-worker.mjs"), sdk: await resolvePackagedPiSdk(path.join(project, "desktop")) })
        : new DeepSeekClient(new MacOSKeychainSecretStore());
      const wrap = (client: ContinuableModelClient): ContinuableModelClient => ({
        async *stream(...args) { streams++; yield* client.stream(...args); },
        async *continue(...args) { continuations++; restoredTurns = args[3]?.history?.length ?? 0; nativeResults = args[1].filter(result => result.callId).length; yield* client.continue(...args); },
      });
      let client = wrap(await makeClient()); let service = new AgentService(store, () => client, app);
      const session = await service.create();
      await service.send({ sessionId: session.id, provider, style: "concise", reasoning: "quick", topicId: "agent-development", contextAllowed: true,
        text: "这是一个合成验收。请立即实际调用 save_artifact，将 export const answer = 42; 保存到 D01 的 implementation。无需查询其他工具或建立计划。授权并保存成功后，只回复“已保存”。" });
      await service.idle();
      const before = (await store.load(session.id)).messages.at(-1)!;
      const card = before.items?.find(item => item.kind === "approval");
      assert.equal(before.status, "waiting"); assert(card?.kind === "approval" && card.tool === "save_artifact");
      assert.equal(card.input.dayId, "D01"); assert.equal(card.input.kind, "implementation"); assert.equal(card.input.text, "export const answer = 42;");
      client = wrap(await makeClient()); service = new AgentService(store, () => client, app);
      await service.answerInteraction(session.id, card.id, "allow"); await service.idle();
      const after = (await store.load(session.id)).messages.at(-1)!;
      assert.equal(after.status, "completed"); assert.equal(after.taskId, before.taskId);
      const artifacts = (await app.evidence.list("agent-development", "D01")).artifacts.length;
      assert.equal(artifacts, 1); assert.equal(streams, 1); assert(continuations >= 1 && restoredTurns >= 1 && nativeResults >= 1);
      const raw = app.database.db.prepare("SELECT checkpoint FROM agent_executions WHERE task_id=?").get(after.taskId) as { checkpoint: string };
      const checkpoint = JSON.parse(raw.checkpoint);
      const privateStatePersisted = [...checkpoint.history, ...(checkpoint.pending ? [checkpoint.pending] : [])].some(turn => turn.events.some((event: { type: string }) => !["text_delta", "tool_call"].includes(event.type)));
      assert.equal(privateStatePersisted, false);
      const result = { provider, passed: true, durationMs: Date.now() - started, streams, continuations, restoredTurns, nativeResults, artifacts, sameTask: true, model: after.model, privateStatePersisted };
      reports.push(result); console.log(JSON.stringify(result));
    } catch {
      const result = { provider, passed: false, durationMs: Date.now() - started, streams, continuations, restoredTurns, nativeResults, code: "live_acceptance_failed" };
      reports.push(result); console.log(JSON.stringify(result)); process.exitCode = 1;
    } finally { app.close(); }
  }
} finally {
  await fs.writeFile(path.resolve(output), JSON.stringify({ date: new Date().toISOString(), syntheticOnly: true, results: reports }, null, 2) + "\n", { mode: 0o600 });
  await fs.rm(root, { recursive: true, force: true });
}
