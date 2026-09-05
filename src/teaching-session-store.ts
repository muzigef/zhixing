import fs from "node:fs/promises";
import crypto from "node:crypto";
import { z } from "zod";
import type { TopicId } from "./contracts.js";
import { PathPolicy } from "./paths.js";

export const teachingStageSchema = z.enum(["answer_questions", "practice", "reflection"]);
export type TeachingStage = z.infer<typeof teachingStageSchema>;
export const teachingSessionSchema = z.object({
  topicId: z.string().min(1),
  dayId: z.string().regex(/^D\d{2}$/).optional(),
  dayCard: z.string().min(1).max(20_000),
  stage: teachingStageSchema,
  quizRound: z.number().int().min(0).max(20).default(0),
  /** Bounded lesson continuity needed to answer/grade after a REPL restart. */
  transcript: z.array(z.string().min(1).max(8_000)).max(12).default([]),
  currentExercise: z.string().max(8_000).optional(),
  learnerAttempts: z.array(z.string().min(1).max(4_000)).max(8).default([]),
  updatedAt: z.string().datetime(),
});
export type TeachingSession = z.infer<typeof teachingSessionSchema>;
export type TeachingSessionInput = Omit<TeachingSession, "topicId" | "updatedAt" | "transcript" | "learnerAttempts"> & Partial<Pick<TeachingSession, "transcript" | "learnerAttempts">>;

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
    const value = teachingSessionSchema.parse({ ...session, topicId, updatedAt: new Date().toISOString(),
      transcript: session.transcript?.slice(-12).map((text) => boundedText(text, 8_000)),
      learnerAttempts: session.learnerAttempts?.slice(-8).map((text) => boundedText(text, 4_000)),
    });
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

function boundedText(text: string, limit: number): string {
  const marker = "\n[上下文已截断]";
  return text.length <= limit ? text : `${text.slice(0, limit - marker.length)}${marker}`;
}
