import fs from "node:fs/promises";
import crypto from "node:crypto";
import type { TopicId } from "./contracts.js";
import { PathPolicy } from "./paths.js";

export { teachingSessionSchema, teachingStageSchema } from "./teaching-session-contracts.js";
export type { TeachingSession, TeachingSessionInput, TeachingStage } from "./teaching-session-contracts.js";
import { teachingCheckpoint, teachingSessionSchema, type TeachingSession, type TeachingSessionInput } from "./teaching-session-contracts.js";

/** Checkpointed, bounded teaching state: restarting the CLI retains the active lesson. */
export class TeachingSessionStore {
  constructor(private readonly paths: PathPolicy) {}

  async load(topicId: TopicId): Promise<TeachingSession | undefined> {
    try {
      await this.paths.assertNoSymlink(topicId, "sessions");
      const value = teachingSessionSchema.parse(JSON.parse(await fs.readFile(this.file(topicId), "utf8")));
      if (value.topicId !== topicId) throw new Error("cross_topic_denied");
      return value;
    }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }

  async save(topicId: TopicId, session: TeachingSessionInput): Promise<TeachingSession> {
    const value = teachingCheckpoint(topicId, session);
    const file = this.file(topicId);
    await this.paths.assertNoSymlink(topicId, "sessions");
    await fs.mkdir(this.paths.topicDir(topicId, "sessions"), { recursive: true });
    await this.paths.assertNoSymlink(topicId, "sessions");
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(value, null, 2), { encoding: "utf8", flag: "wx", mode: 0o600 });
      await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }); }
    return value;
  }

  async clear(topicId: TopicId): Promise<void> { await fs.rm(this.file(topicId), { force: true }); }
  private file(topicId: TopicId): string { return this.paths.resolveTopicPath(topicId, "sessions", "teaching.json"); }
}
