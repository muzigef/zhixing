import fs from "node:fs/promises";
import path from "node:path";
import type { TopicId } from "./contracts.js";

export class CurrentTopicStore {
  constructor(private readonly file: string) {}
  async load(): Promise<TopicId | undefined> { try { const value = JSON.parse(await fs.readFile(this.file, "utf8")) as { topicId?: unknown }; return typeof value.topicId === "string" ? value.topicId as TopicId : undefined; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } }
  async save(topicId: TopicId): Promise<void> { await fs.mkdir(path.dirname(this.file), { recursive: true }); await fs.writeFile(this.file, `${JSON.stringify({ topicId })}\n`, "utf8"); }
}
