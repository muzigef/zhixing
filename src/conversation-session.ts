import fs from "node:fs/promises";
import crypto from "node:crypto";
import { z } from "zod";
import type { TopicId } from "./contracts.js";
import { PathPolicy } from "./paths.js";

const turnSchema = z.object({ user: z.string().min(1).max(8_000), assistant: z.string().max(8_000), status: z.enum(["running", "completed", "interrupted", "incomplete", "failed"]) });
const sessionSchema = z.object({ version: z.literal(1), id: z.string().uuid(), topicId: z.string().min(1), mode: z.enum(["chat", "lesson"]), turns: z.array(turnSchema).max(6), goal: z.string().max(4000).optional(), updatedAt: z.string().datetime() });
export type ConversationSession = z.infer<typeof sessionSchema>;
const pointerSchema = z.object({ topicId: z.string(), id: z.string().uuid() });

export function emptyConversation(topicId: TopicId, mode: ConversationSession["mode"] = "chat"): ConversationSession {
  return { version: 1, id: crypto.randomUUID(), topicId, mode, turns: [], updatedAt: new Date().toISOString() };
}
export function conversationHistory(session: ConversationSession): string[] {
  const history = session.turns.flatMap((turn) => [
    `用户：${turn.user}`,
    ...(turn.assistant ? [`助手${turn.status === "completed" ? "" : "（未完成）"}：${turn.assistant}`] : [`助手（未完成）：上次请求尚未得到完整回答。`]),
  ]);
  if (session.goal && !session.turns.some((turn) => turn.user.startsWith(session.goal!))) history.push(`持续目标（本轮纠正优先）：${session.goal}`);
  return history;
}

/** Topic-local conversations. New sessions preserve earlier ones for explicit resume. */
export class ConversationSessionStore {
  constructor(private readonly paths: PathPolicy) {}
  async current(topicId: TopicId): Promise<ConversationSession | undefined> {
    try {
      const pointer = pointerSchema.parse(await this.read(this.paths.resolveTopicPath(topicId, "sessions", "chat-current.json")));
      if (pointer.topicId !== topicId) throw new Error("cross_topic_denied");
      return await this.load(topicId, pointer.id);
    } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }
  async load(topicId: TopicId, id: string): Promise<ConversationSession> {
    const session = sessionSchema.parse(await this.read(this.file(topicId, id)));
    if (session.topicId !== topicId) throw new Error("cross_topic_denied");
    if (session.id !== id) throw new Error("conversation_id_mismatch");
    return { ...session, turns: session.turns.map((turn) => ({ ...turn, status: turn.status === "running" ? "interrupted" : turn.status })) };
  }
  async save(session: ConversationSession): Promise<ConversationSession> {
    const value = sessionSchema.parse({ ...session, goal: session.goal ?? session.turns[0]?.user.slice(0, 4000), updatedAt: new Date().toISOString(), turns: session.turns.slice(-6).map((turn) => ({ ...turn, user: bounded(turn.user), assistant: bounded(turn.assistant) })) });
    const file = this.file(value.topicId, value.id);
    await this.write(value.topicId, file, value);
    await this.write(value.topicId, this.paths.resolveTopicPath(value.topicId, "sessions", "chat-current.json"), { topicId: value.topicId, id: value.id });
    return value;
  }
  async list(topicId: TopicId): Promise<Array<{ id: string; title: string; updatedAt: string }>> {
    await this.paths.assertNoSymlink(topicId, "sessions");
    let names: string[];
    try { names = await fs.readdir(this.paths.topicDir(topicId, "sessions")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
    const files = names.filter((name) => /^chat-[0-9a-f-]{36}\.json$/.test(name));
    const entries = await Promise.all(files.map(async (name) => {
      const file = this.paths.resolveTopicPath(topicId, "sessions", name);
      return { id: name.slice(5, -5), time: (await fs.stat(file)).mtimeMs };
    }));
    const sessions = await Promise.all(entries.sort((a, b) => b.time - a.time).slice(0, 20).map((entry) => this.load(topicId, entry.id)));
    return sessions.map((session) => ({ id: session.id, title: (session.goal ?? session.turns[0]?.user)?.slice(0, 60).replace(/\s+/g, " ") ?? "新对话", updatedAt: session.updatedAt }));
  }
  private file(topicId: TopicId, id: string): string { return this.paths.resolveTopicPath(topicId, "sessions", `chat-${z.string().uuid().parse(id)}.json`); }
  private async read(file: string): Promise<unknown> {
    // JSON may encode each allowed character as six bytes (for example, \u0001).
    if ((await fs.stat(file)).size > 6 * 2 * 8_000 * 6 + 4000 * 6 + 4_096) throw new Error("conversation_size_limit");
    return JSON.parse(await fs.readFile(file, "utf8"));
  }
  private async write(topicId: TopicId, file: string, value: unknown): Promise<void> {
    await this.paths.assertNoSymlink(topicId, "sessions");
    await fs.mkdir(this.paths.topicDir(topicId, "sessions"), { recursive: true });
    await this.paths.assertNoSymlink(topicId, "sessions");
    const temporary = `${file}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify(value), { encoding: "utf8", flag: "wx", mode: 0o600 });
      await fs.rename(temporary, file);
    } finally { await fs.rm(temporary, { force: true }); }
  }
}
function bounded(text: string): string { return text.length <= 8_000 ? text : `${text.slice(0, 7_990)}\n[内容已截断]`; }
