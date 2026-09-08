import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { AgentService } from "../src/agent-service.js";
import { AgentEventCoalescer } from "../src/agent-events.js";
import type { AgentEvent } from "../src/agent-session-contracts.js";
const roots: string[] = [];
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() { const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-session-index-")); roots.push(root); return { root, store: new AgentSessionStore(root) }; }
it("pages indexed metadata without reparsing unchanged conversations and repairs a damaged index", async () => {
  const { root, store } = await fixture();
  for (let index = 0; index < 60; index++) { const session = await store.create(); session.title = `合成对话 ${index}`; await store.save(session); }
  const load = vi.spyOn(store, "load"); const first = await store.page({ limit: 20 }); expect(first.sessions).toHaveLength(20); expect(first.nextCursor).toBeTruthy();
  load.mockClear(); const second = await store.page({ limit: 20, cursor: first.nextCursor! });
  expect(second.sessions).toHaveLength(20); expect(second.sessions.some(item => first.sessions.some(previous => previous.id === item.id))).toBe(false); expect(load).not.toHaveBeenCalled();
  const changed = await store.load(first.sessions[0]!.id); changed.title = "修改后可搜索"; await store.save(changed);
  expect((await store.page({ query: "可搜索" })).sessions.map(item => item.id)).toEqual([changed.id]);
  await fs.writeFile(path.join(root, "session-index.json"), "broken synthetic index");
  expect((await new AgentSessionStore(root).page({ limit: 100 })).sessions).toHaveLength(60);
});
it("coalesces 1001 IPC deltas and flushes before authoritative metadata and final snapshots", () => {
  vi.useFakeTimers(); const events: AgentEvent[] = []; const coalescer = new AgentEventCoalescer(event => events.push(event));
  const sessionId = crypto.randomUUID(); const messageId = crypto.randomUUID();
  for (let i = 0; i < 1001; i++) coalescer.push({ type: "delta", sessionId, messageId, text: `片${i} ` });
  expect(events).toHaveLength(0);
  coalescer.push({ type: "message_patch", sessionId, messageId, sequence: 1, changes: { activities: [{ label: "完成", status: "completed", at: new Date().toISOString() }] } });
  expect(events.map(event => event.type)).toEqual(["delta", "message_patch"]);
  expect(events[0]).toMatchObject({ text: Array.from({ length: 1001 }, (_, i) => `片${i} `).join("") });
  coalescer.push({ type: "delta", sessionId, messageId, text: "尾段" }); coalescer.push({ type: "settled", sessionId });
  expect(events.slice(-2).map(event => event.type)).toEqual(["delta", "settled"]); coalescer.dispose(); vi.runAllTimers(); expect(events).toHaveLength(4);
});
it("does not repeat the full prior conversation for progress events", async () => {
  const { store } = await fixture(); const session = await store.create();
  session.messages = Array.from({ length: 100 }, (_, index) => ({ id: crypto.randomUUID(), role: index % 2 ? "assistant" as const : "user" as const, text: "保留的历史原文。".repeat(100), status: "completed" as const, createdAt: new Date().toISOString() })); await store.save(session);
  const service = new AgentService(store, () => ({ async *stream() { for (let i = 0; i < 20; i++) { yield { type: "progress" as const, phase: "requesting" as const }; } yield { type: "text_delta" as const, text: "合成回答" }; yield { type: "done" as const }; } }));
  const events: AgentEvent[] = []; service.subscribe(event => events.push(event));
  await service.send({ sessionId: session.id, text: "解释", provider: "mock", style: "adaptive" }); await service.idle(); await service.pauseMaintenance();
  expect(events.filter(event => event.type === "session").length).toBeLessThanOrEqual(3);
  const patches = events.filter(event => event.type === "message_patch"); expect(patches.length).toBeGreaterThan(0);
  expect(JSON.stringify(patches)).not.toContain("保留的历史原文"); expect((await store.load(session.id)).messages).toHaveLength(102);
});
