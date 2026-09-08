import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { AgentService } from "../src/agent-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { DeepSeekClient } from "../src/deepseek-client.js";
import { MacOSKeychainSecretStore } from "../src/macos-keychain.js";
import { LearningApplication } from "../src/learning-application.js";

if (!process.argv.includes("--live") || process.env.ZHIXING_ALLOW_LIVE_PROVIDER === "0") throw new Error("explicit_live_required");
const output = process.argv.find(arg => arg.startsWith("--output="))?.slice(9);
if (!output) throw new Error("explicit_output_required");
await fs.writeFile(output, "{}\n", { flag: "wx", mode: 0o600 });
const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-sequences-"));
const app = await LearningApplication.open(path.join(root, "workspace"), process.cwd());
const store = new AgentSessionStore(path.join(root, "chats"));
const service = new AgentService(store, () => new DeepSeekClient(new MacOSKeychainSecretStore()), app);
const report: Record<string, unknown> = { syntheticOnly: true, provenance: await app.provenance() };
try {
  const session = await service.create();
  session.topicId = "rag"; session.workspaceId = app.summary().id;
  const reference = "测试项目代号：青竹-5831；样本规模 37。";
  session.messages = Array.from({ length: 2400 }, (_, index) => ({ id: randomUUID(), role: index % 2 ? "assistant" as const : "user" as const, text: index === 1500 ? reference : `合成历史片段 ${index}，正在讨论抽象的学习步骤。这一条不含项目代号。`, status: "completed" as const, createdAt: new Date().toISOString() }));
  await store.save(session);
  await service.send({ sessionId: session.id, provider: "deepseek-api", topicId: "rag", style: "concise", reasoning: "quick", text: "请回读当前对话 message 序号 1500 的原文，告诉我项目代号和样本规模。不要根据最近上下文猜测。" });
  await service.idle(); await service.pauseMaintenance();
  const answer = (await store.load(session.id)).messages.at(-1)!;
  assert.equal(answer.status, "completed"); assert.match(answer.text, /青竹.?5831/); assert.match(answer.text, /37/); assert.ok((answer.timings?.toolCalls ?? 0) >= 1);
  report.history = { status: answer.status, text: answer.text, durationMs: answer.durationMs, toolCalls: answer.timings?.toolCalls, sourceMessages: 2400 };
  const cancel = await service.create();
  await service.send({ sessionId: cancel.id, provider: "deepseek-api", style: "detailed", reasoning: "deep", text: "请详细推导线性回归的梯度、Hessian、凸性，包含矩阵证明与多个数值例子。" });
  await new Promise(resolve => setTimeout(resolve, 750));
  const stoppedAt = Date.now(); service.stop(); await service.idle(); await service.pauseMaintenance();
  const interrupted = (await store.load(cancel.id)).messages.at(-1)!;
  assert.equal(interrupted.status, "interrupted"); assert.ok(Date.now() - stoppedAt < 3000);
  report.cancel = { status: interrupted.status, settleMs: Date.now() - stoppedAt };
  await service.send({ sessionId: cancel.id, provider: "deepseek-api", style: "concise", reasoning: "quick", text: "停止推导。现在只回答 6 乘 7 的整数结果。" });
  await service.idle(); await service.pauseMaintenance();
  const resumed = (await store.load(cancel.id)).messages.at(-1)!;
  assert.equal(resumed.status, "completed"); assert.match(resumed.text, /42/);
  report.recovery = { status: resumed.status, text: resumed.text, durationMs: resumed.durationMs }; report.passed = true;
} catch (error) { report.passed = false; report.error = String(error); process.exitCode = 1; }
finally { service.stop(); await service.idle(); await service.pauseMaintenance(); app.close(); await fs.rm(root, { recursive: true, force: true }); await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 }); console.log(JSON.stringify({ passed: report.passed, history: report.history, cancel: report.cancel, recovery: report.recovery, error: report.error })); }
