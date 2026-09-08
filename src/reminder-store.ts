import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod/v4";
import type { TopicId } from "./contracts.js";
import { PathPolicy } from "./paths.js";
import { atomicJson, readJson } from "./agent-session-store.js";
const reminderSchema = z.object({ time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), enabled: z.boolean() }).strict();

/** Opt-in schedule. Exclusive daily claims prevent duplicate notifications across local hosts. */
export class ReminderStore {
  constructor(private readonly paths: PathPolicy) {}
  async set(topicId: TopicId, time: string): Promise<void> { await this.write(topicId, reminderSchema.parse({ time, enabled: true })); }
  async disable(topicId: TopicId): Promise<void> { const value = await this.status(topicId); if (value) await this.write(topicId, { ...value, enabled: false }); }
  async status(topicId: TopicId): Promise<{ time: string; enabled: boolean } | undefined> {
    try { return reminderSchema.parse(await readJson(this.file(topicId), 4096)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  async claimDue(topicId: TopicId, now: Date): Promise<boolean> {
    if (!Number.isFinite(now.getTime())) throw new Error("reminder_time_invalid");
    const value = await this.status(topicId); if (!value?.enabled) return false;
    const [hour, minute] = value.time.split(":").map(Number); const elapsed = now.getHours() * 60 + now.getMinutes() - (hour! * 60 + minute!);
    if (elapsed < 0 || elapsed >= 5) return false;
    const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const file = this.paths.resolveTopicPath(topicId, "notes", "reminder-delivery", `${day}.json`);
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await this.paths.assertNoSymlink(topicId, "notes");
    try { await fs.writeFile(file, JSON.stringify({ claimedAt: now.toISOString() }), { flag: "wx", mode: 0o600 }); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
  }
  private async write(topicId: TopicId, value: { time: string; enabled: boolean }): Promise<void> { await atomicJson(this.file(topicId), value, 4096); }
  private file(topicId: TopicId): string { return this.paths.resolveTopicPath(topicId, "notes", "REMINDER.json"); }
}

/** Hosts provide the notification surface; schedule and deduplication policy stay shared. */
export class ReminderScheduler {
  private timer?: NodeJS.Timeout; private stopped = false; private work?: Promise<void>;
  constructor(private readonly store: ReminderStore, private readonly topics: () => readonly string[], private readonly notify: (topics: string[]) => void | Promise<void>, private readonly onError: () => void = () => undefined) {}
  start(): void { if (this.timer) return; this.stopped = false; const tick = () => { void this.tick(new Date()).catch(() => this.onError()); }; tick(); this.timer = setInterval(tick, 15_000); this.timer.unref(); }
  stop(): void { this.stopped = true; clearInterval(this.timer); this.timer = undefined; }
  async tick(now: Date): Promise<void> {
    if (this.stopped) return;
    if (this.work) return this.work;
    this.work = (async () => {
      const due: string[] = [];
      for (const topic of this.topics()) {
        if (this.stopped) return;
        try { if (await this.store.claimDue(topic, now)) due.push(topic); }
        catch { this.onError(); }
      }
      if (due.length && !this.stopped) await this.notify(due);
    })();
    try { await this.work; } finally { this.work = undefined; }
  }
}
