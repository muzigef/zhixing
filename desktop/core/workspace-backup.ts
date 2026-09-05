import fs from "node:fs/promises";
import { createWriteStream, constants } from "node:fs";
import { pipeline } from "node:stream/promises";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import { inspectDatabaseSnapshot } from "../../src/database.js";
import type { LearningApplication } from "../../src/learning-application.js";
import { PathPolicy } from "../../src/paths.js";
import { DesktopStore } from "./store.js";
import { chatSchema } from "./contracts.js";

const manifestSchema = z.object({ format: z.literal("zhixing-workspace-backup"), version: z.literal(1), appVersion: z.string().max(40), createdAt: z.string().datetime(), workspaceId: z.string().regex(/^[a-f0-9]{64}$/), files: z.array(z.object({ path: z.string().min(1).max(4096), bytes: z.number().int().nonnegative().max(2_000_000_000), sha256: z.string().regex(/^[a-f0-9]{64}$/) })).max(20000) });
type Manifest = z.infer<typeof manifestSchema>;
const privateName = /^(?:\.env(?:\..*)?|auth\.json|.*\.credential|credentials?(?:\..*)?|tokens?(?:\..*)?)$/i;
const workspaceRoots = ["zhixing/data", "zhixing/topics", "zhixing/skills", "zhixing/settings", "zhixing/inbox", "learning-notes"];
function allowed(relative: string): boolean {
  const parts = relative.split("/");
  if (path.isAbsolute(relative) || relative.includes("\\") || parts.some((part) => !part || part === "." || part === ".." || privateName.test(part))) return false;
  return relative === "workspace/zhixing/db/zhixing.sqlite" || relative === "desktop/preferences.json" || relative.startsWith("desktop/conversations/") || workspaceRoots.some((root) => relative.startsWith(`workspace/${root}/`));
}
function safe(root: string, relative: string): string { return new PathPolicy(root).resolveWorkspacePath(...relative.split("/")); }
async function digest(file: string, signal: AbortSignal): Promise<{ bytes: number; sha256: string }> {
  const hash = crypto.createHash("sha256"); let bytes = 0;
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  for await (const chunk of handle.createReadStream({ signal })) { bytes += chunk.length; if (bytes > 2_000_000_000) throw new Error("backup_size_limit"); hash.update(chunk); }
  return { bytes, sha256: hash.digest("hex") };
}
async function copy(source: string, destination: string, signal: AbortSignal) {
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const handle = await fs.open(source, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  await pipeline(handle.createReadStream(), createWriteStream(destination, { flags: "wx", mode: 0o600 }), { signal });
}
async function* walk(root: string, relative: string): AsyncIterable<string> {
  const file = path.join(root, relative); let stat;
  try { stat = await fs.lstat(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
  if (stat.isSymbolicLink()) throw new Error("backup_link_denied");
  if (stat.isDirectory()) {
    for (const entry of await fs.readdir(file)) if (!privateName.test(entry)) yield* walk(root, `${relative}/${entry}`);
  } else if (stat.isFile()) yield relative;
}
/** Explicit user export; only application-owned data and a consistent SQLite snapshot are included. */
export async function createWorkspaceBackup(app: LearningApplication, store: DesktopStore, directory: string, appVersion: string, signal: AbortSignal): Promise<string> {
  await store.flush();
  const parent = await fs.realpath(directory).catch((error) => { if (error.code === "ENOENT") return path.resolve(directory); throw error; });
  if ([app.root, path.join(store.root, "conversations")].some((root) => parent === root || parent.startsWith(`${root}${path.sep}`))) throw new Error("backup_destination_invalid");
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  const target = await fs.mkdtemp(path.join(await fs.realpath(parent), "Zhixing-backup-"));
  const manifest: Manifest = { format: "zhixing-workspace-backup", version: 1, appVersion, createdAt: new Date().toISOString(), workspaceId: app.summary().id, files: [] };
  let total = 0;
  const record = async (relative: string) => {
    const item = await digest(safe(target, relative), signal); total += item.bytes;
    if (total > 2_000_000_000 || manifest.files.length >= 20000) throw new Error("backup_size_limit");
    manifest.files.push({ path: relative, ...item });
  };
  try {
    for (const root of workspaceRoots) for await (const relative of walk(app.root, root)) {
      signal.throwIfAborted(); const destination = `workspace/${relative}`; if (!allowed(destination)) continue;
      await copy(safe(app.root, relative), safe(target, destination), signal); await record(destination);
    }
    const database = "workspace/zhixing/db/zhixing.sqlite"; await app.database.backup(safe(target, database)); await record(database);
    for (const root of ["conversations", "preferences.json"]) for await (const relative of walk(store.root, root)) {
      signal.throwIfAborted(); const destination = `desktop/${relative}`; if (!allowed(destination)) continue;
      await copy(safe(store.root, relative), safe(target, destination), signal); await record(destination);
    }
    await fs.writeFile(safe(target, "manifest.json"), JSON.stringify(manifest, null, 2), { flag: "wx", mode: 0o600 }); return target;
  } catch (error) { await fs.rm(target, { recursive: true, force: true }); throw error; }
}
export async function inspectWorkspaceBackup(directory: string, signal: AbortSignal): Promise<Manifest> {
  const file = safe(directory, "manifest.json"); if ((await fs.stat(file)).size > 4_000_000) throw new Error("backup_size_limit");
  const manifest = manifestSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
  const seen = new Set<string>(); let total = 0;
  for (const item of manifest.files) {
    signal.throwIfAborted(); const key = item.path.toLowerCase();
    if (!allowed(item.path) || seen.has(key)) throw new Error("backup_path_invalid");
    seen.add(key); total += item.bytes; if (total > 2_000_000_000) throw new Error("backup_size_limit");
    const actual = await digest(safe(directory, item.path), signal);
    if (actual.bytes !== item.bytes || actual.sha256 !== item.sha256) throw new Error("backup_integrity_failed");
  }
  if (!seen.has("workspace/zhixing/db/zhixing.sqlite")) throw new Error("backup_invalid");
  inspectDatabaseSnapshot(safe(directory, "workspace/zhixing/db/zhixing.sqlite"));
  return manifest;
}
/** Non-destructive restore: new workspace, remapped conversation IDs, no inherited execution grants. */
export async function restoreWorkspaceBackup(directory: string, parent: string, store: DesktopStore, signal: AbortSignal): Promise<{ workspace: string; sessions: number }> {
  const manifest = await inspectWorkspaceBackup(directory, signal);
  await fs.mkdir(parent, { recursive: true, mode: 0o700 }); const workspace = await fs.mkdtemp(path.join(parent, "workspace-"));
  try {
    for (const item of manifest.files.filter((item) => item.path.startsWith("workspace/"))) {
      const destination = safe(workspace, item.path.slice(10)); await copy(safe(directory, item.path), destination, signal);
      if ((await digest(destination, signal)).sha256 !== item.sha256) throw new Error("backup_integrity_failed");
    }
    const chats = [];
    for (const item of manifest.files.filter((item) => /^desktop\/conversations\/[0-9a-f-]{36}\.json$/i.test(item.path))) {
      if (item.bytes > 12_000_000) throw new Error("backup_size_limit");
      chats.push(chatSchema.parse(JSON.parse(await fs.readFile(safe(directory, item.path), "utf8"))));
    }
    const ids = new Map(chats.map((chat) => [chat.id, crypto.randomUUID()]));
    const workspaceId = crypto.createHash("sha256").update(path.resolve(workspace)).digest("hex");
    for (const chat of chats) {
      signal.throwIfAborted(); chat.id = ids.get(chat.id)!; chat.title = `${chat.title.slice(0, 68)} · 恢复`;
      chat.executionAllowed = false; chat.contextAllowed = false; chat.pendingRequests = []; chat.queuePaused = true;
      if (chat.topicId && chat.workspaceId === manifest.workspaceId) chat.workspaceId = workspaceId;
      chat.parent = chat.parent && ids.has(chat.parent.sessionId) ? { ...chat.parent, sessionId: ids.get(chat.parent.sessionId)! } : undefined;
      for (const message of chat.messages) if (message.status === "running") message.status = "interrupted";
      await store.save(chat);
    }
    return { workspace, sessions: chats.length };
  } catch (error) {
    // Keep partially restored data for inspection; never delete conversations already imported.
    await fs.writeFile(safe(workspace, "RESTORE-INCOMPLETE.txt"), "恢复未完成。原工作区与备份未改变，可重新恢复为另一个工作区。", { mode: 0o600 });
    throw error;
  }
}
