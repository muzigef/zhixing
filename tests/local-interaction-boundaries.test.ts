import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { afterEach, expect, it, vi } from "vitest";
import { LocalSyncServer } from "../src/sync-server.js";
import { ReminderStore, ReminderScheduler } from "../src/reminder-store.js";
import { PathPolicy } from "../src/paths.js";
import { PromptAssembler, ReplController } from "../src/repl-controller.js";
const cleanups: (() => Promise<void>)[] = []; afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });
it("requires a per-process access key, rejects browser origins, and closes live SSE subscriptions promptly", async () => {
  const progress = vi.fn(async () => ({ completed: 1 })); const server = new LocalSyncServer(progress, ["rag"]); const port = await server.listen(); cleanups.push(() => server.close());
  const url = `http://127.0.0.1:${port}/topics/rag/progress`;
  expect((await fetch(url)).status).toBe(401); expect(progress).not.toHaveBeenCalled();
  const headers = { authorization: server.authorizationHeader() };
  expect((await fetch(url, { headers: { ...headers, origin: "https://untrusted.example" } })).status).toBe(403); expect(progress).not.toHaveBeenCalled();
  expect((await fetch(url, { headers })).status).toBe(200);
  const subscription = http.get(`http://127.0.0.1:${port}/topics/rag/events`, { headers });
  await new Promise<void>((resolve, reject) => { subscription.once("response", response => { response.once("data", () => resolve()); response.resume(); }); subscription.once("error", reject); });
  await Promise.race([server.close(), new Promise((_, reject) => setTimeout(() => reject(new Error("close_hung")), 1000))]); subscription.destroy();
});
it("claims an opted-in reminder once per local day across instances and suppresses disabled or missed reminders", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-reminder-due-")); cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
  const first = new ReminderStore(new PathPolicy(root)), second = new ReminderStore(new PathPolicy(root));
  await first.set("rag", "20:30"); const now = new Date(2026, 8, 8, 20, 31);
  expect((await Promise.all([first.claimDue("rag", now), second.claimDue("rag", now)])).filter(Boolean)).toHaveLength(1);
  expect(await second.claimDue("rag", new Date(2026, 8, 9, 20, 40))).toBe(false);
  await first.disable("rag"); expect(await second.claimDue("rag", new Date(2026, 8, 9, 20, 31))).toBe(false);
  await first.set("rag", "20:30"); expect(await second.claimDue("rag", new Date(2026, 8, 9, 20, 31))).toBe(true);
});
it("coalesces due topics into one notification and never duplicates on concurrent ticks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-reminder-tick-")); cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
  const store = new ReminderStore(new PathPolicy(root)); await store.set("rag", "20:30"); await store.set("tool-calling", "20:30");
  const notify = vi.fn(); const scheduler = new ReminderScheduler(store, () => ["rag", "tool-calling"], notify);
  await Promise.all([scheduler.tick(new Date(2026, 8, 8, 20, 30)), scheduler.tick(new Date(2026, 8, 8, 20, 30))]);
  expect(notify).toHaveBeenCalledTimes(1); expect(notify).toHaveBeenCalledWith(["rag", "tool-calling"]);
  scheduler.stop(); await scheduler.tick(new Date(2026, 8, 9, 20, 30)); expect(notify).toHaveBeenCalledTimes(1);
});
it("accepts the same 20000-character message in the CLI composer and shared request path", async () => {
  const text = "长".repeat(12_000), input = new PromptAssembler();
  expect(input.accept(text)).toEqual({ kind: "message", text });
  const execute = vi.fn(async () => {}), queue = new ReplController({ execute, interrupt: async () => {} });
  queue.submit(text); await queue.drain(); expect(execute).toHaveBeenCalledWith(text);
  expect(input.accept("长".repeat(20_001)).kind).toBe("collecting");
});
it("isolates a corrupt reminder so other topics still notify", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-reminder-corrupt-")); cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
  const paths = new PathPolicy(root), store = new ReminderStore(paths);
  await store.set("rag", "20:30"); await store.set("tool-calling", "20:30");
  await fs.writeFile(paths.resolveTopicPath("rag", "notes", "REMINDER.json"), "broken");
  const notify = vi.fn(), onError = vi.fn();
  await new ReminderScheduler(store, () => ["rag", "tool-calling"], notify, onError).tick(new Date(2026, 8, 8, 20, 30));
  expect(onError).toHaveBeenCalledTimes(1); expect(notify).toHaveBeenCalledWith(["tool-calling"]);
});
