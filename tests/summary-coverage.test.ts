import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { AgentService } from "../src/agent-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { buildMessages } from "../src/learning-agent-profile.js";
import type { ModelClient } from "../src/model.js";
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

async function fixture(count: number, summary: (prompt: string, signal: AbortSignal) => Promise<string> = async () => "连续摘要") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-summary-coverage-"));
  const batches: { previousSummary?: string; transcript: { text: string }[] }[] = [];
  const client: ModelClient = { async *stream(prompt, signal) {
    if (prompt.startsWith("请整理")) { batches.push(JSON.parse(prompt.slice(prompt.indexOf("{")))); yield { type: "text_delta", text: await summary(prompt, signal) }; }
    else yield { type: "text_delta", text: "继续当前问题。" };
    yield { type: "done" };
  } };
  const service = new AgentService(new AgentSessionStore(root), () => client);
  cleanups.push(async () => { service.stop(); await service.idle(); await service.pauseMaintenance(); await fs.rm(root, { recursive: true, force: true }); });
  const session = await service.create();
  for (let index = 0; index < count; index++) session.messages.push({ id: crypto.randomUUID(), role: index % 2 ? "assistant" : "user", text: `M${index + 1}`, status: "completed", createdAt: session.createdAt });
  await service.store.save(session);
  const send = async () => { await service.send({ sessionId: session.id, text: "继续", provider: "mock", style: "adaptive" }); await service.idle(); await service.idleMaintenance(); return service.load(session.id); };
  return { service, session, batches, send };
}

it.each([50, 200])("summarizes %i queued historical messages in contiguous batches without falsely covering unread messages", async count => {
  const { session, batches, send } = await fixture(count);
  let covered = 0;
  for (let index = 0; index < Math.ceil((count - 6) / 24); index++) {
    const saved = await send();
    const batch = batches.at(-1)!;
    expect(batch.transcript[0]?.text).toBe(`M${covered + 1}`);
    expect(batch.transcript).toHaveLength(Math.min(24, saved.messages.length - 8 - covered));
    covered += batch.transcript.length;
    expect(saved.context?.summaryThroughId).toBe(saved.messages[covered - 1]?.id);
    expect(saved.messages.slice(0, count)).toEqual(session.messages);
    const observations = buildMessages(saved, { sessionId: session.id, text: "继续", provider: "mock", style: "adaptive" }).filter(message => message.role === "observation");
    expect(JSON.parse(observations[0]!.content).summarySource.messageCount).toBe(covered);
  }
});

it("does not trust old unverified summary coverage and rebuilds from the start", async () => {
  const { service, session, batches, send } = await fixture(50);
  session.context = { goal: "", notes: "", summary: "未经核对的旧摘要", summaryThroughId: session.messages[41]!.id };
  const messages = buildMessages(session, { sessionId: session.id, text: "继续", provider: "mock", style: "adaptive" });
  expect(JSON.parse(messages.find(message => message.role === "observation")!.content).summarySource).toBeUndefined();
  await service.store.save(session); await send();
  expect(batches[0]?.transcript[0]?.text).toBe("M1");
  expect(batches[0]?.previousSummary).toBeUndefined();
});

it("invalidates a summary when a covered source message is edited", async () => {
  const { session, send } = await fixture(50); const saved = await send();
  saved.messages[5]!.text = "更正历史事实";
  const messages = buildMessages(saved, { sessionId: session.id, text: "继续", provider: "mock", style: "adaptive" });
  expect(JSON.parse(messages.find(message => message.role === "observation")!.content).summaryAuthority).toBeUndefined();
});

it("retains successful coverage when a later batch fails", async () => {
  let attempt = 0;
  const { batches, send } = await fixture(80, async () => { if (++attempt > 1) throw new Error("synthetic_failure"); return "已整理首批"; });
  const first = await send(); const failed = await send();
  expect(batches).toHaveLength(2);
  expect(failed.context?.summaryThroughId).toBe(first.context?.summaryThroughId);
  expect(failed.context?.summary).toBe("已整理首批");
  expect(failed.messages.at(-1)?.status).toBe("completed");
});

it("uses context pressure to summarize a few long messages before the message-count threshold", async () => {
  const { service, session, batches, send } = await fixture(12);
  for (const message of session.messages) message.text += "长上下文".repeat(1000);
  await service.store.save(session); const saved = await send();
  expect(batches).toHaveLength(1);
  expect(batches[0]?.transcript).toHaveLength(6);
  expect(saved.context?.summaryThroughId).toBe(session.messages[5]?.id);
  expect(saved.messages.slice(0, 12)).toEqual(session.messages);
});

it("does not commit coverage or lose the completed answer when maintenance is cancelled", async () => {
  let ready!: () => void; const started = new Promise<void>(resolve => { ready = resolve; });
  const { service, session } = await fixture(50, async (_prompt, signal) => {
    ready(); await new Promise<void>(resolve => { if (signal.aborted) resolve(); else signal.addEventListener("abort", () => resolve(), { once: true }); });
    signal.throwIfAborted(); return "不会提交";
  });
  await service.send({ sessionId: session.id, text: "继续", provider: "mock", style: "adaptive" }); await service.idle(); await started;
  await service.pauseMaintenance();
  const saved = await service.load(session.id);
  expect(saved.context?.summaryThroughId).toBeUndefined();
  expect(saved.context?.summarySourceHash).toBeUndefined();
  expect(saved.messages.at(-1)?.status).toBe("completed");
  expect(saved.messages.slice(0, 50)).toEqual(session.messages);
});
