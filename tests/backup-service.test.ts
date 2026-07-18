import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { previewBackup, restoreBackup } from "../src/backup-service.js";
import { ZhixingDatabase } from "../src/database.js";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
describe("backup preview", () => { it("验证临时 SQLite 备份元数据而不替换目标", async () => { const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-backup-")); roots.push(root); const db = new ZhixingDatabase(path.join(root, "source.sqlite")); const backup = path.join(root, "backup.sqlite"); await db.backup(backup); db.close(); await expect(previewBackup(backup)).resolves.toMatchObject({ migrations: 2 }); await expect(restoreBackup(backup, path.join(root, "target.sqlite"), false)).rejects.toThrow("restore_confirmation_required"); await expect(restoreBackup(backup, path.join(root, "target.sqlite"), true)).resolves.toBeUndefined(); }); });
