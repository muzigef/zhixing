import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash, randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { inspectDatabaseSnapshot } from "./database.js";
const restoring = new Set<string>();
async function signature(file: string, missing = false): Promise<string | undefined> {
  try {
    const stat = await fs.lstat(file, { bigint: true });
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1n) throw new Error("backup_link_denied");
    return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  } catch (error) { if (missing && (error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
}
async function noSidecars(file: string, reason: string): Promise<void> {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try { await fs.lstat(`${file}${suffix}`); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") continue; throw error; }
    throw new Error(reason);
  }
}
/** Caller must close all target database users. Never delete possibly uncheckpointed sidecars. */
export async function restoreBackup(backup: string, target: string, confirmed: boolean, expectedHash?: string): Promise<void> {
  if (!confirmed) throw new Error("restore_confirmation_required");
  const key = path.resolve(target); if (restoring.has(key)) throw new Error("restore_in_progress");
  restoring.add(key); const temporary = `${target}.${randomUUID()}.restore`;
  try {
    const preview = await previewBackup(backup);
    if (expectedHash && preview.sha256 !== expectedHash) throw new Error("backup_changed");
    const original = await signature(target, true); await noSidecars(target, "restore_target_in_use");
    await fs.copyFile(backup, temporary, constants.COPYFILE_EXCL); await fs.chmod(temporary, 0o600);
    const staged = await previewBackup(temporary);
    if (staged.sha256 !== preview.sha256) throw new Error("backup_changed");
    await noSidecars(target, "restore_target_in_use");
    if (await signature(target, true) !== original) throw new Error("restore_target_changed");
    await fs.rename(temporary, target);
  } finally { try { await fs.rm(temporary, { force: true }); } finally { restoring.delete(key); } }
}

export async function previewBackup(file: string): Promise<{ bytes: number; migrations: number; sha256: string }> {
  const before = await signature(file); await noSidecars(file, "backup_in_use");
  if ((await fs.stat(file)).size > 2_000_000_000) throw new Error("backup_size_limit");
  // SQLite may create WAL/SHM even for a read-only connection. Inspect only our private copy.
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-backup-inspect-")); const snapshot = path.join(directory, "snapshot.sqlite");
  try {
    await fs.copyFile(file, snapshot, constants.COPYFILE_EXCL); await fs.chmod(snapshot, 0o600);
    const handle = await fs.open(snapshot, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); const hash = createHash("sha256"); let bytes = 0;
    try { for await (const chunk of handle.createReadStream({ autoClose: false })) { bytes += chunk.length; if (bytes > 2_000_000_000) throw new Error("backup_size_limit"); hash.update(chunk); } }
    finally { await handle.close(); }
    inspectDatabaseSnapshot(snapshot);
    const db = new Database(snapshot, { readonly: true, fileMustExist: true }); let migrations: number;
    try { migrations = (db.prepare("SELECT count(*) AS count FROM schema_migrations").get() as { count: number }).count; } finally { db.close(); }
    if (await signature(file) !== before) throw new Error("backup_changed");
    await noSidecars(file, "backup_in_use");
    return { bytes, migrations, sha256: hash.digest("hex") };
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
