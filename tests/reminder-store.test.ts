import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PathPolicy } from "../src/paths.js";
import { ReminderStore } from "../src/reminder-store.js";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
describe("reminder store", () => { it("persists only an opt-in local schedule", async () => { const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-reminder-")); roots.push(root); const store = new ReminderStore(new PathPolicy(root)); await store.set("rag", "20:30"); await expect(store.status("rag")).resolves.toEqual({ time: "20:30", enabled: true }); }); });
