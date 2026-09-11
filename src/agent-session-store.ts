import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { z } from "zod/v4";
import { messageSchema, chatSchema, type ChatSession, type SessionSummary } from "./agent-session-contracts.js";
export class AgentSessionStore {
  private metadata?: Map<string, { signature: string; summary?: SessionSummary }>;
  private knownVersions = new Map<string, { signature: string; version: number }>();
  private indexing?: Promise<SessionSummary[]>;
  private async signature(file: string): Promise<string> { await assertNotLinked(file); const stat = await fs.stat(file); return `${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`; }
  private sessionWrites = new Map<string, Promise<void>>();
  constructor(readonly root: string) {}
  private sessionPath(id: string): string {
    return path.join(
      this.root,
      "conversations",
      `${z.string().uuid().parse(id)}.json`,
    );
  }
  async create(): Promise<ChatSession> {
    const now = new Date().toISOString();
    const session: ChatSession = {
      version: 8,
      id: randomUUID(),
      title: "新对话",
      customTitle: false,
      createdAt: now,
      updatedAt: now,
      messages: [],
      teaching: null,
    };
    await this.save(session);
    return session;
  }
  async load(id: string): Promise<ChatSession> {
    await this.sessionWrites.get(id);
    const raw = await readJson(this.sessionPath(id), 12_000_000) as Record<string, unknown>;
    const session = chatSchema.parse(raw);
    if (raw.segments !== undefined) {
      if (![7, 8, 9, 10, 11, 12, 13].includes(Number(raw.version)) || session.id !== id) throw new Error("session_segment_invalid");
      const segments = z.array(z.object({ hash: z.string().regex(/^[a-f0-9]{64}$/), count: z.number().int().min(1).max(250) }).strict()).max(80).parse(raw.segments);
      const prefix: typeof session.messages = []; let bytes = 0;
      for (const segment of segments) {
        const messages = await this.readSegment(id, segment.hash);
        if (messages.length !== segment.count) throw new Error("session_segment_invalid");
        bytes += Buffer.byteLength(JSON.stringify(messages)); if (bytes > 12_000_000) throw new Error("storage_limit");
        prefix.push(...messages);
      }
      session.messages = [...prefix, ...session.messages];
      chatSchema.parse(session);
      if (Buffer.byteLength(JSON.stringify(session)) > 12_000_000) throw new Error("storage_limit");
    }
    if (session.id !== id) throw new Error("session_invalid");
    session.version = raw.version === 13 ? 13 : raw.version === 12 ? 12 : raw.version === 11 ? 11 : raw.version === 10 ? 10 : raw.version === 9 ? 9 : 8;
    for (const message of session.messages) {
      if (message.status === "running") message.status = "interrupted";
      if (message.team && ["preparing", "planning", "running", "merging"].includes(message.team.status)) {
        message.team.status = "interrupted";
        for (const member of message.team.members) if (["queued", "running"].includes(member.status)) member.status = "interrupted";
        for (const task of message.team.tasks ?? []) if (["queued", "running"].includes(task.status)) task.status = "interrupted";
        const review = message.team.review;
        if (review && ["pending", "running"].includes(review.status)) review.status = "interrupted";
        if (review?.recheck && ["pending", "running"].includes(review.recheck.status)) review.recheck.status = "interrupted";
        if (review?.followUp && ["pending", "running"].includes(review.followUp.status)) review.followUp.status = "interrupted";
      }
    }
    return session;
  }
  async save(session: ChatSession): Promise<void> {
    const hasTeam = session.collaboration && session.collaboration.mode !== "single" || session.messages.some(message => message.team || message.collaboration && message.collaboration.mode !== "single") || session.pendingRequests?.some(request => request.collaboration && request.collaboration.mode !== "single");
    const hasReviewProtocol = session.messages.some(message => message.team?.protocol === 2 || message.team?.review);
    const checked = chatSchema.parse({ ...session, version: session.version === 13 || session.messages.some(message => message.team?.members.some(member => member.resourcePolicy)) ? 13 : session.version === 12 || session.messages.some(message => message.team && (message.team.nativeTasks !== undefined || [message.team.lead, ...message.team.members.map(member => member.binding)].some(binding => binding.provider.startsWith("native-")))) ? 12 : session.version === 11 || session.messages.some(message => message.team?.protocol === 3) ? 11 : session.version === 10 || hasReviewProtocol ? 10 : session.version === 9 || hasTeam ? 9 : 8 });
    chatSchema.parse(session);
    if (Buffer.byteLength(JSON.stringify(checked)) > 12_000_000) throw new Error("storage_limit");
    const pending = (this.sessionWrites.get(checked.id) ?? Promise.resolve()).catch(() => undefined)
      .then(async () => {
        const file = this.sessionPath(checked.id);
        try {
          const signature = await this.signature(file);
          const known = this.knownVersions.get(checked.id);
          const old = known?.signature === signature ? known : await readJson(file, 12_000_000) as { version?: number };
          if (![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].includes(old.version ?? 0) || (old.version ?? 0) > checked.version) throw new Error("storage_version_unsupported");
          if (old.version && old.version < checked.version) {
            await assertNotLinked(`${file}.v${old.version}.bak`);
            try { await fs.copyFile(file, `${file}.v${old.version}.bak`, constants.COPYFILE_EXCL); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
          }
        } catch (error) { if (!isMissing(error)) throw error; }
        await assertNotLinked(path.join(this.root, "conversations"));
        const segments: { hash: string; count: number }[] = [];
        let offset = 0;
        while (checked.messages.length - offset > 250) {
          const messages = checked.messages.slice(offset, offset + 250);
          const value = { sessionId: checked.id, messages };
          const hash = createHash("sha256").update(JSON.stringify(value)).digest("hex");
          const segmentFile = path.join(this.root, "conversations", checked.id, `${hash}.json`);
          try { await this.readSegment(checked.id, hash, true); }
          catch (error) { if (!isMissing(error)) throw error; await atomicJson(segmentFile, value, 12_000_000); }
          segments.push({ hash, count: messages.length }); offset += messages.length;
        }
        await atomicJson(file, { ...checked, messages: checked.messages.slice(offset), ...(segments.length ? { segments } : {}) }, 12_000_000);
        this.knownVersions.set(checked.id, { signature: await this.signature(file), version: checked.version }); this.metadata?.delete(checked.id);
        session.version = checked.version;
      });
    this.sessionWrites.set(checked.id, pending);
    try { await pending; }
    finally { if (this.sessionWrites.get(checked.id) === pending) this.sessionWrites.delete(checked.id); }
  }
  private async readSegment(id: string, hash: string, preserveMissing = false) {
    try {
      const raw = await readJson(path.join(this.root, "conversations", id, `${hash}.json`), 12_000_000);
      const value = z.object({ sessionId: z.literal(id), messages: z.array(messageSchema).min(1).max(250) }).strict().parse(raw);
      if (createHash("sha256").update(JSON.stringify(value)).digest("hex") !== hash) throw new Error("session_segment_invalid");
      return value.messages;
    } catch (error) { if (preserveMissing && isMissing(error)) throw error; throw new Error("session_segment_invalid"); }
  }
  async list(): Promise<SessionSummary[]> {
    this.indexing ??= this.index();
    try { return structuredClone(await this.indexing); } finally { this.indexing = undefined; }
  }
  async page(options: { limit?: number; cursor?: string; query?: string } = {}): Promise<{ sessions: SessionSummary[]; nextCursor: string | null; total: number }> {
    const input = z.object({ limit: z.number().int().min(1).max(100).default(40), cursor: z.string().max(500).optional(), query: z.string().max(200).default("") }).strict().parse(options);
    let all = (await this.list()).filter(item => item.title.toLocaleLowerCase().includes(input.query.toLocaleLowerCase())); const total = all.length;
    if (input.cursor) {
      const cursor = z.object({ updatedAt: z.string().datetime(), id: z.string().uuid() }).strict().parse(JSON.parse(Buffer.from(input.cursor, "base64url").toString("utf8")));
      all = all.filter(item => item.updatedAt < cursor.updatedAt || item.updatedAt === cursor.updatedAt && item.id.localeCompare(cursor.id) < 0);
    }
    const sessions = all.slice(0, input.limit); const last = sessions.at(-1);
    return { sessions, total, nextCursor: all.length > input.limit && last ? Buffer.from(JSON.stringify({ updatedAt: last.updatedAt, id: last.id })).toString("base64url") : null };
  }
  private async index(): Promise<SessionSummary[]> {
    await this.flush(); let names: string[];
    try { await assertNotLinked(path.join(this.root, "conversations")); names = await fs.readdir(path.join(this.root, "conversations")); }
    catch (error) { if (isMissing(error)) return []; throw error; }
    const file = path.join(this.root, "session-index.json");
    if (!this.metadata) {
      this.metadata = new Map();
      try {
        const summary = z.object({ id: z.string().uuid(), title: z.string().min(1).max(80), createdAt: z.string().datetime(), updatedAt: z.string().datetime() }).strict();
        const parsed = z.object({ version: z.literal(1), entries: z.array(z.object({ id: z.string().uuid(), signature: z.string().max(200), summary: summary.optional() }).strict()).max(20_000) }).strict().parse(await readJson(file, 4_000_000));
        for (const entry of parsed.entries) if (!entry.summary || entry.summary.id === entry.id) this.metadata.set(entry.id, entry);
      } catch { /* Derived metadata can be rebuilt; conversation files remain authoritative. */ }
    }
    let changed = false; const ids = new Set(names.filter(name => /^[0-9a-f-]{36}\.json$/i.test(name)).map(name => name.slice(0, -5)));
    for (const id of this.metadata.keys()) if (!ids.has(id)) { this.metadata.delete(id); changed = true; }
    for (const id of ids) {
      try {
        const signature = await this.signature(this.sessionPath(id));
        if (this.metadata.get(id)?.signature === signature) continue;
        let summary: SessionSummary | undefined;
        try { const { title, createdAt, updatedAt } = await this.load(id); summary = { id, title, createdAt, updatedAt }; } catch { /* Damaged/future versions remain on disk. */ }
        if (signature !== await this.signature(this.sessionPath(id))) { this.metadata.set(id, { signature: "unstable", summary: summary ?? this.metadata.get(id)?.summary }); changed = true; continue; }
        this.metadata.set(id, { signature, summary }); changed = true;
      } catch { this.metadata.delete(id); changed = true; }
    }
    if (changed) {
      const entries = [...this.metadata].map(([id, item]) => ({ id, ...item }));
      if (entries.length <= 20_000) try { await atomicJson(file, { version: 1, entries }, 4_000_000); } catch { /* Optional cache failure must not hide healthy history. */ }
    }
    return [...this.metadata.values()].flatMap(item => item.summary ? [item.summary] : []).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  }
  async flush(): Promise<void> { await Promise.all(this.sessionWrites.values()); }
}
export async function readJson(file: string, maximum: number): Promise<unknown> {
  await assertNotLinked(path.dirname(file));
  await assertNotLinked(file);
  const handle = await fs.open(
    file,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > maximum) throw new Error("storage_limit");
    return JSON.parse(await handle.readFile("utf8")) as unknown;
  } finally {
    await handle.close();
  }
}
export async function atomicJson(
  file: string,
  value: unknown,
  maximum: number,
): Promise<void> {
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > maximum) throw new Error("storage_limit");
  await assertNotLinked(path.dirname(file));
  await assertNotLinked(file);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, text, { mode: 0o600, flag: "wx" });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}
function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function assertNotLinked(file: string): Promise<void> {
  try {
    if ((await fs.lstat(file)).isSymbolicLink())
      throw new Error("storage_path_invalid");
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
}
