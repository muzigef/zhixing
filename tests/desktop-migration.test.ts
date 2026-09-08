import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, it } from "vitest";
import { DesktopStore } from "../desktop/core/store.js";
import { ZhixingDatabase } from "../src/database.js";

it.each([1, 2, 3])("reads v%s without rewriting it, backs it up when saving v4, and rejects future versions", async (version) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-migration-"));
  try {
    const store = new DesktopStore(root); const chat = await store.create();
    const file = path.join(root, "conversations", `${chat.id}.json`);
    const original = JSON.stringify({ ...chat, version }); await fs.writeFile(file, original);
    const loaded = await store.load(chat.id); expect(loaded.version).toBe(4);
    expect(await fs.readFile(file, "utf8")).toBe(original);
    await store.save(loaded); expect(await fs.readFile(`${file}.v${version}.bak`, "utf8")).toBe(original);
    expect(JSON.parse(await fs.readFile(file, "utf8")).version).toBe(4);
    await fs.writeFile(file, JSON.stringify({ ...chat, version: 99 }));
    await expect(store.load(chat.id)).rejects.toThrow();
    await expect(store.save(loaded)).rejects.toThrow("storage_version_unsupported");
    expect(JSON.parse(await fs.readFile(file, "utf8")).version).toBe(99);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
it("persists twelve model rounds and the exact project approval preview in v4", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-project-migration-"));
  try {
    const store = new DesktopStore(root); const chat = await store.create();
    const timing = { transport: "sse" as const, startupMs: 1, requestMs: 2, selectionMs: 0, totalMs: 4, processTailMs: 1 };
    chat.messages.push({ id: crypto.randomUUID(), role: "assistant", text: "", status: "waiting", createdAt: new Date().toISOString(), modelTimings: Array.from({ length: 12 }, () => timing), items: [{ id: crypto.randomUUID(), kind: "approval", title: "项目修改", tool: "project_edit", input: {}, preview: "--- README.md\n+++ README.md\n+合成记录", status: "pending" }] });
    await store.save(chat); const restored = await store.load(chat.id);
    expect(restored.version).toBe(4); expect(restored.messages).toEqual(chat.messages);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
it("refuses a database from a newer version before migration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-db-version-")); const file = path.join(root, "db.sqlite");
  try { const db = new ZhixingDatabase(file); db.db.prepare("INSERT INTO schema_migrations VALUES (99, ?)").run(new Date().toISOString()); db.close(); expect(() => new ZhixingDatabase(file)).toThrow("storage_version_unsupported"); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
});
