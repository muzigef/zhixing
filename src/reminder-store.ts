import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { TopicId } from "./contracts.js";
import { PathPolicy } from "./paths.js";

const reminderSchema = z.object({ time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/), enabled: z.boolean() });

/** Stores an opt-in local reminder plan; it never starts a background process or sends notifications. */
export class ReminderStore {
  constructor(private readonly paths: PathPolicy) {}
  async set(topicId: TopicId, time: string): Promise<void> { await this.write(topicId, reminderSchema.parse({ time, enabled: true })); }
  async status(topicId: TopicId): Promise<{ time: string; enabled: boolean } | undefined> {
    try { return reminderSchema.parse(JSON.parse(await fs.readFile(this.file(topicId), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  private async write(topicId: TopicId, value: { time: string; enabled: boolean }): Promise<void> {
    const file = this.file(topicId); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, `${JSON.stringify(value)}\n`, "utf8");
  }
  private file(topicId: TopicId): string { return this.paths.resolveTopicPath(topicId, "notes", "REMINDER.json"); }
}
