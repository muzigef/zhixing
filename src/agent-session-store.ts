import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { chatSchema, type ChatSession, type SessionSummary } from "./agent-session-contracts.js";
export class AgentSessionStore {
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
      version: 4,
      id: randomUUID(),
      title: "新对话",
      customTitle: false,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    await this.save(session);
    return session;
  }
  async load(id: string): Promise<ChatSession> {
    await this.sessionWrites.get(id);
    const session = chatSchema.parse(
      await readJson(this.sessionPath(id), 12_000_000),
    );
    if (session.id !== id) throw new Error("session_invalid");
    session.version = 4;
    for (const message of session.messages)
      if (message.status === "running") message.status = "interrupted";
    return session;
  }
  async save(session: ChatSession): Promise<void> {
    const checked = chatSchema.parse({ ...session, version: 4 });
    chatSchema.parse(session);
    const pending = (this.sessionWrites.get(checked.id) ?? Promise.resolve()).catch(() => undefined)
      .then(async () => {
        const file = this.sessionPath(checked.id);
        try {
          const old = await readJson(file, 12_000_000) as { version?: number };
          if (![1, 2, 3, 4].includes(old.version ?? 0)) throw new Error("storage_version_unsupported");
          if (old.version === 1 || old.version === 2 || old.version === 3) {
            await assertNotLinked(`${file}.v${old.version}.bak`);
            try { await fs.copyFile(file, `${file}.v${old.version}.bak`, constants.COPYFILE_EXCL); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
          }
        } catch (error) { if (!isMissing(error)) throw error; }
        await atomicJson(file, checked, 12_000_000);
      });
    this.sessionWrites.set(checked.id, pending);
    try { await pending; }
    finally { if (this.sessionWrites.get(checked.id) === pending) this.sessionWrites.delete(checked.id); }
  }
  async list(): Promise<SessionSummary[]> {
    let names: string[];
    try {
      await assertNotLinked(path.join(this.root, "conversations"));
      names = await fs.readdir(path.join(this.root, "conversations"));
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    const sessions: SessionSummary[] = [];
    for (const name of names.filter((name) =>
      /^[0-9a-f-]{36}\.json$/i.test(name),
    )) {
      try {
        const session = await this.load(name.slice(0, -5));
        const { id, title, createdAt, updatedAt } = session;
        sessions.push({ id, title, createdAt, updatedAt });
      } catch {
        /* Preserve damaged files; healthy conversations remain available. */
      }
    }
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
