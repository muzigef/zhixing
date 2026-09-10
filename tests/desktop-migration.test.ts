import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, it } from "vitest";
import { DesktopStore } from "../desktop/core/store.js";
import { ZhixingDatabase } from "../src/database.js";
import { teamConfigurationSchema, teamSnapshotSchema } from "../src/team-contracts.js";

it.each([1, 2, 3, 4, 5, 6, 7])("reads v%s without rewriting it, backs it up when saving v8, and rejects future versions", async (version) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-migration-"));
  try {
    const store = new DesktopStore(root); const chat = await store.create();
    const file = path.join(root, "conversations", `${chat.id}.json`);
    const original = JSON.stringify({ ...chat, version }); await fs.writeFile(file, original);
    const loaded = await store.load(chat.id); expect(loaded.version).toBe(8);
    expect(await fs.readFile(file, "utf8")).toBe(original);
    await store.save(loaded); expect(await fs.readFile(`${file}.v${version}.bak`, "utf8")).toBe(original);
    expect(JSON.parse(await fs.readFile(file, "utf8")).version).toBe(8);
    await fs.writeFile(file, JSON.stringify({ ...chat, version: 99 }));
    await expect(store.load(chat.id)).rejects.toThrow();
    await expect(store.save(loaded)).rejects.toThrow("storage_version_unsupported");
    expect(JSON.parse(await fs.readFile(file, "utf8")).version).toBe(99);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
it("persists twelve model rounds and the exact project approval preview in v8", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-project-migration-"));
  try {
    const store = new DesktopStore(root); const chat = await store.create();
    const timing = { transport: "sse" as const, startupMs: 1, requestMs: 2, selectionMs: 0, totalMs: 4, processTailMs: 1 };
    chat.messages.push({ id: crypto.randomUUID(), role: "assistant", text: "", status: "waiting", createdAt: new Date().toISOString(), modelTimings: Array.from({ length: 12 }, () => timing), items: [{ id: crypto.randomUUID(), kind: "approval", title: "项目修改", tool: "project_edit", input: {}, preview: "--- README.md\n+++ README.md\n+合成记录", status: "pending" }] });
    await store.save(chat); const restored = await store.load(chat.id);
    expect(restored.version).toBe(8); expect(restored.messages).toEqual(chat.messages);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
it("refuses a database from a newer version before migration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-db-version-")); const file = path.join(root, "db.sqlite");
  try { const db = new ZhixingDatabase(file); db.db.prepare("INSERT INTO schema_migrations VALUES (99, ?)").run(new Date().toISOString()); db.close(); expect(() => new ZhixingDatabase(file)).toThrow("storage_version_unsupported"); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
});

it("marks the new database semantics so older binaries cannot silently discard product/permission evidence", () => {
  const db = new ZhixingDatabase(":memory:");
  try { expect((db.db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as { version: number }).version).toBe(6); }
  finally { db.close(); }
});

it("upgrades team review records to v10 with a v9 backup, restores interrupted phases, and refuses stale downgrades", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-review-migration-"));
  try {
    const store = new DesktopStore(root); const chat = await store.create();
    chat.collaboration = teamConfigurationSchema.parse({ mode: "same-model-team", memberTimeoutMs: 90_000 });
    await store.save(chat); expect(chat.version).toBe(9);
    const stale = structuredClone(chat); const file = path.join(root, "conversations", `${chat.id}.json`); const original = await fs.readFile(file, "utf8");
    const team = teamSnapshotSchema.parse({ id: crypto.randomUUID(), mode: "same-model-team", status: "running", lead: { provider: "mock", model: "mock", connection: "local", reasoning: "balanced" }, members: [], modelTurns: 4, toolCalls: 0, reservedOutputTokens: 200, estimatedInputTokens: 500, inputTokens: 100, outputTokens: 200, unknownUsageRequests: 0, protocol: 2, review: { status: "completed", verdict: "needs-check", followUp: { status: "running", member: 1, question: "复核条件" } } });
    chat.messages = Array.from({ length: 251 }, () => ({ id: crypto.randomUUID(), role: "assistant" as const, text: "合成会话", status: "completed" as const, createdAt: new Date().toISOString() }));
    chat.messages[0]!.team = team;
    await store.save(chat); expect(Number(chat.version)).toBe(10);
    expect(await fs.readFile(`${file}.v9.bak`, "utf8")).toBe(original);
    const restored = await new DesktopStore(root).load(chat.id); expect(Number(restored.version)).toBe(10); expect(restored.messages).toHaveLength(251);
    expect(restored.messages[0]?.team).toMatchObject({ status: "interrupted", review: { status: "completed", followUp: { status: "interrupted" } } });
    await expect(store.save(stale)).rejects.toThrow("storage_version_unsupported");
    expect(Number((await store.load(chat.id)).version)).toBe(10);
    team.review = { status: "running" }; chat.messages[0]!.team = team; await store.save(chat);
    expect((await store.load(chat.id)).messages[0]?.team?.review?.status).toBe("interrupted");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
