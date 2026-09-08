import { expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DesktopStore } from "../desktop/core/store.js";

it("reads all previously submitted preference changes and keeps them across restart", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-preference-order-"));
  const store = new DesktopStore(root);
  try {
    const initial = await store.settings();
    await store.saveSettings(initial);
    const first = { ...initial, deepseekModel: "deepseek-v4-pro" };
    const latest = { ...first, contextBudget: { windowTokens: 24000, reserveOutputTokens: 4096 } };
    const writes = [store.saveSettings(first), store.saveSettings(latest)];
    try { expect(await store.settings()).toEqual(latest); }
    finally { await Promise.all(writes); }
    await store.flush();
    expect(await new DesktopStore(root).settings()).toEqual(latest);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

it("can read committed preferences after a failed save and subsequent disk recovery", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-preference-recovery-"));
  const store = new DesktopStore(root);
  try {
    const initial = await store.settings();
    const file = path.join(root, "preferences.json");
    await fs.mkdir(file);
    await expect(store.saveSettings(initial)).rejects.toThrow();
    await fs.rmdir(file);
    expect(await store.settings()).toEqual(initial);
    const next = { ...initial, deepseekModel: "deepseek-v4-pro" };
    await store.saveSettings(next);
    expect(await store.settings()).toEqual(next);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
