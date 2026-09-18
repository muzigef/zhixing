import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AgentSessionStore } from "../src/agent-session-store.js";
import type { ChatSession } from "../src/agent-session-contracts.js";
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-save-boundary-")); roots.push(root);
  const store = new AgentSessionStore(root); const session = await store.create();
  session.messages = Array.from({ length: 2000 }, (_, i) => ({ id: crypto.randomUUID(), role: "user" as const, text: `Immutable original ${i}`, status: "completed" as const, createdAt: session.createdAt }));
  await store.save(session); await store.save(session);
  const file = path.join(root, "conversations", `${session.id}.json`);
  const raw = JSON.parse(await fs.readFile(file, "utf8"));
  return { root, store, session, file, segment: path.join(root, "conversations", session.id, `${raw.segments[0].hash}.json`) };
}
it("avoids rereading verified unchanged segments for a tail update and preserves exact reload", async () => {
  const { store, session } = await fixture(); const open = vi.spyOn(fs, "open");
  session.messages.at(-1)!.text = "Only tail changed"; await store.save(session);
  expect(open.mock.calls.filter(([file]) => /[a-f0-9]{64}\.json$/.test(String(file)))).toHaveLength(0);
  open.mockRestore(); expect((await new AgentSessionStore(store.root).load(session.id)).messages).toEqual(session.messages);
});
it("invalidates warm segment trust on same-size tampering without overwriting the corrupt evidence", async () => {
  const { store, session, segment, file } = await fixture(); const originalManifest = await fs.readFile(file, "utf8");
  const changed = (await fs.readFile(segment, "utf8")).replace("Immutable", "Corrupted");
  await fs.writeFile(segment, changed);
  await expect(store.save(session)).rejects.toThrow("session_segment_invalid");
  expect(await fs.readFile(segment, "utf8")).toBe(changed); expect(await fs.readFile(file, "utf8")).toBe(originalManifest);
});
it("does not follow a replaced segment directory and safely reconstructs a genuinely missing segment", async () => {
  const { root, store, session, segment } = await fixture();
  await fs.rm(segment); await store.save(session);
  expect((await store.load(session.id)).messages).toEqual(session.messages);
  const directory = path.dirname(segment), relocated = path.join(root, "synthetic-outside");
  await fs.rename(directory, relocated); await fs.symlink(relocated, directory, process.platform === "win32" ? "junction" : "dir");
  await expect(store.save(session)).rejects.toThrow();
});
it("revalidates earlier message edits, captures a submission snapshot, and rejects unknown input versions", async () => {
  const { store, session } = await fixture();
  session.messages[0]!.text = "Explicit earlier correction";
  const pending = store.save(session); session.messages[0]!.text = "Mutation after submission"; await pending;
  expect((await store.load(session.id)).messages[0]!.text).toBe("Explicit earlier correction");
  await expect(store.save({ ...session, version: 99 } as unknown as ChatSession)).rejects.toThrow();
  expect((await store.load(session.id)).messages[0]!.text).toBe("Explicit earlier correction");
});
