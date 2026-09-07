import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expect, it } from "vitest";
import { DesktopStore } from "../desktop/core/store.js";
import { ZhixingDatabase } from "../src/database.js";

it.each([1, 2])("reads v%s without rewriting it, backs it up when saving v3, and rejects future versions", async (version) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-migration-"));
  try {
    const store = new DesktopStore(root); const chat = await store.create();
    const file = path.join(root, "conversations", `${chat.id}.json`);
    const original = JSON.stringify({ ...chat, version }); await fs.writeFile(file, original);
    const loaded = await store.load(chat.id); expect(loaded.version).toBe(3);
    expect(await fs.readFile(file, "utf8")).toBe(original);
    await store.save(loaded); expect(await fs.readFile(`${file}.v${version}.bak`, "utf8")).toBe(original);
    expect(JSON.parse(await fs.readFile(file, "utf8")).version).toBe(3);
    await fs.writeFile(file, JSON.stringify({ ...chat, version: 99 }));
    await expect(store.load(chat.id)).rejects.toThrow();
    await expect(store.save(loaded)).rejects.toThrow("storage_version_unsupported");
    expect(JSON.parse(await fs.readFile(file, "utf8")).version).toBe(99);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
it("refuses a database from a newer version before migration", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-db-version-")); const file = path.join(root, "db.sqlite");
  try { const db = new ZhixingDatabase(file); db.db.prepare("INSERT INTO schema_migrations VALUES (99, ?)").run(new Date().toISOString()); db.close(); expect(() => new ZhixingDatabase(file)).toThrow("storage_version_unsupported"); }
  finally { await fs.rm(root, { recursive: true, force: true }); }
});
