import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { AgentService } from "../src/agent-service.js";
const roots: string[] = []; afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() { const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-segments-")); roots.push(root); const store = new AgentSessionStore(root); return { root, store, session: await store.create() }; }
it("segments 2000 messages and restores exact ordered originals, reusing immutable segments", async () => {
  const { root, store, session } = await fixture();
  session.messages = Array.from({ length: 2000 }, (_, i) => ({ id: crypto.randomUUID(), role: i % 2 ? "assistant" as const : "user" as const, text: `原文 ${i}`, status: "completed" as const, createdAt: session.createdAt }));
  await store.save(session);
  const file = path.join(root, "conversations", `${session.id}.json`); const raw = JSON.parse(await fs.readFile(file, "utf8"));
  expect(raw.version).toBe(7); expect(raw.messages.length).toBeLessThanOrEqual(250); expect(raw.segments.length).toBeGreaterThan(0);
  expect((await new AgentSessionStore(root).load(session.id)).messages).toEqual(session.messages);
  session.messages.at(-1)!.text += " 追加尾部"; await store.save(session);
  expect(JSON.parse(await fs.readFile(file, "utf8")).segments).toEqual(raw.segments);
  const model = { async *stream() { yield { type: "text_delta" as const, text: "继续回答" }; yield { type: "done" as const }; } };
  const service = new AgentService(store, () => model);
  await service.invoke({ sessionId: session.id, provider: "mock", style: "adaptive", text: "继续" }); await service.pauseMaintenance();
  expect((await store.load(session.id)).messages).toHaveLength(2002);
});
it("fails closed on missing or changed segments and preserves the legacy file backup", async () => {
  const { root, store, session } = await fixture();
  const file = path.join(root, "conversations", `${session.id}.json`);
  const legacy = { ...session, version: 6, messages: Array.from({ length: 600 }, (_, i) => ({ id: crypto.randomUUID(), role: "user", text: `原始 ${i}`, status: "completed", createdAt: session.createdAt })) };
  await fs.writeFile(file, JSON.stringify(legacy)); await store.save(await store.load(session.id));
  expect(JSON.parse(await fs.readFile(`${file}.v6.bak`, "utf8"))).toEqual(legacy);
  const raw = JSON.parse(await fs.readFile(file, "utf8")); const segment = path.join(root, "conversations", session.id, `${raw.segments[0].hash}.json`);
  await fs.writeFile(segment, '{}');
  await expect(store.load(session.id)).rejects.toThrow("session_segment_invalid");
});
