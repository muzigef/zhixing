import fs from "node:fs/promises";
import Database from "better-sqlite3";

/** Inspects a backup before any separately confirmed restore operation. */
export async function restoreBackup(backup: string, target: string, confirmed: boolean): Promise<void> {
  if (!confirmed) throw new Error("restore_confirmation_required");
  await previewBackup(backup);
  const temporary = `${target}.${process.pid}.restore`;
  await fs.copyFile(backup, temporary);
  await fs.rm(`${target}-wal`, { force: true });
  await fs.rm(`${target}-shm`, { force: true });
  await fs.rename(temporary, target);
}

export async function previewBackup(file: string): Promise<{ bytes: number; migrations: number }> {
  const stat = await fs.stat(file);
  const db = new Database(file, { readonly: true });
  try {
    const row = db.prepare("SELECT count(*) AS count FROM schema_migrations").get() as { count: number };
    return { bytes: stat.size, migrations: row.count };
  } finally { db.close(); }
}
