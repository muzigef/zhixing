import { unifiedDiff, applyReplacements } from "./project-diff.js";
import { runPythonTests } from "./python-runner.js";
import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod/v4";
import { PathPolicy } from "./paths.js";
import { topicIdSchema } from "./contracts.js";
import type { ZhixingDatabase } from "./database.js";
import { LocalSandbox } from "./local-sandbox.js";

const exec = promisify(execFile);
const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const privateFile = /^(?:auth\.json|credentials?(?:\..*)?|tokens?(?:\..*)?|secrets?(?:\..*)?|package-lock\.json)$/i;
export const projectPathSchema = z.string().max(300).regex(/^(?:[a-zA-Z0-9_-]{1,64}\/){0,4}[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}\.(?:mjs|js|py|json|md|txt)$/).refine(value => value.split("/").every(part => !privateFile.test(part)) && value !== "zhixing_runner.py");
export const projectEditSchema = z.object({ path: projectPathSchema, expectedHash: hashSchema.nullable(), content: z.string().max(24_000) }).strict();
export const projectBatchSchema = z.array(projectEditSchema.extend({ content: z.string().max(24_000).nullable() })).min(1).max(10);
export const projectPatchSchema = z.object({ path: projectPathSchema, expectedHash: hashSchema, replacements: z.array(z.object({ before: z.string().min(1).max(24_000), after: z.string().max(24_000) }).strict()).min(1).max(10) }).strict();
export type ProjectBatch = z.infer<typeof projectBatchSchema>;
export type ProjectEdit = z.infer<typeof projectEditSchema>;
const testSchema = z.object({ invalidated: z.boolean().optional(), id: z.string().uuid(), treeHash: hashSchema, status: z.enum(["completed", "timed_out", "unavailable", "cancelled"]), stdout: z.string().max(64_000), stderr: z.string().max(64_000), exitCode: z.number().int().nullable(), createdAt: z.string().datetime() });
const recordSchema = z.object({ id: z.string().uuid(), topicId: topicIdSchema, title: z.string().min(1).max(80), createdAt: z.string().datetime(), test: testSchema.optional() });
type ProjectRecord = z.infer<typeof recordSchema>;
const gitConfig = "[core]\n\trepositoryformatversion = 0\n\tbare = true\n\tfilemode = false\n";
const starter = {
  "README.md": "# 实践项目\n\n这是独立的练习目录。修改实现和测试后运行项目测试，再保存 Git 检查点。测试通过只说明这些测试通过，不等于已掌握知识。\n",
  "src/implementation.mjs": "export const solve = value => value;\n",
  "test/implementation.test.mjs": "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { solve } from '../src/implementation.mjs';\ntest('returns the supplied value', () => assert.equal(solve(42), 42));\n",
};
const pythonStarter = { "README.md": "# Python 实践项目\n\n使用标准库 unittest；不自动安装依赖。测试通过只说明当前测试的范围。\n", "implementation.py": "def solve(value):\n    return value\n", "test_example.py": "import unittest\nfrom implementation import solve\nclass Example(unittest.TestCase):\n    def test_value(self):\n        self.assertEqual(solve(42), 42)\n" };
type ProjectFile = { path: string; content: string; hash: string; bytes: number };
export type ProjectSnapshot = ProjectRecord & { files: Omit<ProjectFile, "content">[]; treeHash: string; currentTestsPassed: boolean; branch: string; head: string; diff: string; history: { commit: string; title: string }[]; snapshots: { id: string; treeHash: string; createdAt: string }[] };

/** A managed directory and separate bare Git repository per practice project. */
export class PracticeProjects {
  private readonly paths: PathPolicy;
  constructor(private readonly root: string, private readonly database: ZhixingDatabase) {
    this.paths = new PathPolicy(root);
    database.db.exec("CREATE TABLE IF NOT EXISTS practice_projects(id TEXT PRIMARY KEY,topic TEXT NOT NULL,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS practice_selection(topic TEXT PRIMARY KEY,id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS practice_leases(id TEXT PRIMARY KEY,lease TEXT NOT NULL,pid INTEGER NOT NULL)");
  }
  private initializeRevisions(): void {
    this.database.db.exec("CREATE TABLE IF NOT EXISTS project_snapshots(id TEXT PRIMARY KEY, project TEXT NOT NULL, topic TEXT NOT NULL, tree_hash TEXT NOT NULL, files TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS project_changes(project TEXT PRIMARY KEY, topic TEXT NOT NULL, id TEXT NOT NULL, before_hash TEXT NOT NULL, after_hash TEXT NOT NULL, state TEXT NOT NULL); CREATE TABLE IF NOT EXISTS project_mutation_receipts(project TEXT NOT NULL, key TEXT NOT NULL, result TEXT NOT NULL, PRIMARY KEY(project,key))");
  }
  list(topic: string): ProjectRecord[] { topicIdSchema.parse(topic); return (this.database.db.prepare("SELECT value FROM practice_projects WHERE topic=? ORDER BY id").all(topic) as { value: string }[]).map(row => recordSchema.parse(JSON.parse(row.value))); }
  selected(topic: string): string | null { topicIdSchema.parse(topic); const row = this.database.db.prepare("SELECT id FROM practice_selection WHERE topic=?").get(topic) as { id: string } | undefined; if (row) this.record(topic, row.id); return row?.id ?? null; }
  select(topic: string, id: string | null): void {
    topicIdSchema.parse(topic);
    if (id) { this.record(topic, id); this.database.db.prepare("INSERT INTO practice_selection VALUES (?,?) ON CONFLICT(topic) DO UPDATE SET id=excluded.id").run(topic, id); }
    else this.database.db.prepare("DELETE FROM practice_selection WHERE topic=?").run(topic);
  }
  static clearSelections(database: ZhixingDatabase): void {
    if (database.db.prepare("SELECT name FROM sqlite_master WHERE name='practice_selection'").get()) database.db.exec("DELETE FROM practice_selection");
    if (database.db.prepare("SELECT name FROM sqlite_master WHERE name='practice_leases'").get()) database.db.exec("DELETE FROM practice_leases");
  }
  private record(topic: string, id: string): ProjectRecord {
    topicIdSchema.parse(topic); z.string().uuid().parse(id);
    const row = this.database.db.prepare("SELECT topic,value FROM practice_projects WHERE id=?").get(id) as { topic: string; value: string } | undefined;
    if (!row) throw new Error("project_not_found"); if (row.topic !== topic) throw new Error("cross_topic_denied");
    const record = recordSchema.parse(JSON.parse(row.value)); if (record.topicId !== topic || record.id !== id) throw new Error("project_storage_invalid"); return record;
  }
  private directory(topic: string, id: string, ...parts: string[]): string { topicIdSchema.parse(topic); z.string().uuid().parse(id); return this.paths.resolveWorkspacePath("zhixing", "projects", topic, id, ...parts); }
  private async lease<T>(id: string, action: () => Promise<T>): Promise<T> {
    const lease = randomUUID();
    this.database.db.transaction(() => {
      const owner = this.database.db.prepare("SELECT pid FROM practice_leases WHERE id=?").get(id) as { pid: number } | undefined;
      if (owner) { try { process.kill(owner.pid, 0); throw new Error("project_busy"); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw new Error("project_busy"); } }
      this.database.db.prepare("INSERT INTO practice_leases VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET lease=excluded.lease,pid=excluded.pid").run(id, lease, process.pid);
    })();
    try { return await action(); } finally { this.database.db.prepare("DELETE FROM practice_leases WHERE id=? AND lease=?").run(id, lease); }
  }
  async create(topic: string, title: string, signal: AbortSignal, selectedDirectory?: string, language: "javascript" | "python" = "javascript"): Promise<ProjectSnapshot> {
    const record = recordSchema.parse({ id: randomUUID(), topicId: topic, title: title.trim(), createdAt: new Date().toISOString() });
    if (this.list(topic).length >= 20) throw new Error("project_limit");
    const files = selectedDirectory ? await this.importFiles(selectedDirectory, signal) : language === "python" ? pythonStarter : starter;
    if (!Object.keys(files).length) throw new Error("project_empty"); signal.throwIfAborted();
    const directory = this.directory(topic, record.id); await fs.mkdir(this.directory(topic, record.id, "files"), { recursive: true, mode: 0o700 });
    try {
      for (const [name, content] of Object.entries(files)) { const target = this.directory(topic, record.id, "files", name); await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 }); await fs.writeFile(target, content, { flag: "wx", mode: 0o600, signal }); }
      await this.git(topic, record.id, ["init", "--bare", `--initial-branch=practice/${record.id}`, "--template=", this.directory(topic, record.id, "repository.git")], signal, true);
      await fs.writeFile(this.directory(topic, record.id, "repository.git", "config"), gitConfig, { mode: 0o600 });
      const captured = await this.files(topic, record.id); this.validateFiles(captured);
      await this.commitTree(topic, record.id, captured, "创建独立实践项目", signal, false);
      this.database.db.prepare("INSERT INTO practice_projects VALUES (?,?,?)").run(record.id, topic, JSON.stringify(record));
      return await this.snapshot(topic, record.id);
    } catch (error) {
      // Only this fresh, unregistered copy is rolled back; the selected source is unchanged.
      if (!this.database.db.prepare("SELECT id FROM practice_projects WHERE id=?").get(record.id)) await fs.rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
  private async importFiles(selected: string, signal: AbortSignal): Promise<Record<string, string>> {
    const stat = await fs.lstat(selected); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("project_import_denied");
    const policy = new PathPolicy(await fs.realpath(selected)); const files: Record<string, string> = {}; let bytes = 0; let entries = 0;
    const visit = async (relative: string, depth: number): Promise<void> => {
      if (depth > 4) return;
      for (const entry of await fs.readdir(policy.resolveWorkspacePath(relative), { withFileTypes: true })) {
        signal.throwIfAborted(); if (++entries > 2000) throw new Error("project_limit");
        if (entry.name.startsWith(".") || ["node_modules", "vendor", "dist", "build"].includes(entry.name) || privateFile.test(entry.name)) continue;
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) throw new Error("project_link_denied");
        if (entry.isDirectory()) { await visit(name, depth + 1); continue; }
        if (!projectPathSchema.safeParse(name).success) continue;
        const file = await this.readFile(policy.resolveWorkspacePath(name), name); files[name] = file.content; bytes += file.bytes;
        if (Object.keys(files).length > 40 || bytes > 256_000) throw new Error("project_limit");
      }
    };
    await visit("", 0); return files;
  }
  private async readFile(target: string, name: string): Promise<ProjectFile> {
    const file = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try { const stat = await file.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.size > 24_000) throw new Error("project_file_denied"); const bytes = await file.readFile(); const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes); if (content.includes("\0")) throw new Error("project_file_denied"); return { path: name, content, hash: hash(bytes), bytes: bytes.length }; }
    finally { await file.close(); }
  }
  async read(topic: string, id: string, name: string): Promise<ProjectFile> { this.record(topic, id); await this.recover(topic, id); projectPathSchema.parse(name); return this.readFile(this.directory(topic, id, "files", name), name); }
  private async files(topic: string, id: string, area = "files"): Promise<ProjectFile[]> {
    const result: ProjectFile[] = []; let total = 0; let entries = 0;
    const visit = async (relative: string): Promise<void> => {
      for (const entry of await fs.readdir(this.directory(topic, id, area, relative), { withFileTypes: true })) {
        if (++entries > 200) throw new Error("project_limit");
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) throw new Error("project_link_denied");
        if (entry.isDirectory()) { if (!/^(?:[a-zA-Z0-9_-]{1,64}\/){0,3}[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new Error("project_file_denied"); await visit(name); }
        else { projectPathSchema.parse(name); const file = await this.readFile(this.directory(topic, id, area, name), name); result.push(file); total += file.bytes; if (result.length > 40 || total > 256_000) throw new Error("project_limit"); }
      }
    };
    await visit(""); return result.sort((a, b) => a.path.localeCompare(b.path));
  }
  private treeHash(files: ProjectFile[]): string { return hash(JSON.stringify(files.map(file => [file.path, file.hash]))); }
  async snapshot(topic: string, id: string, signal = new AbortController().signal): Promise<ProjectSnapshot> {
    const record = this.record(topic, id); await this.recover(topic, id); const files = await this.files(topic, id); const treeHash = this.treeHash(files); signal.throwIfAborted();
    const head = (await this.git(topic, id, ["rev-parse", "HEAD"], signal)).trim();
    const history = (await this.git(topic, id, ["log", "-20", "--format=%H%x09%s"], signal)).trim().split("\n").filter(Boolean).map(line => { const [commit, ...title] = line.split("\t"); return { commit: commit!, title: title.join("\t") }; });
    let diff = await this.git(topic, id, ["diff", "--no-ext-diff", "--no-textconv", "HEAD", "--", "."], signal);
    const untracked = (await this.git(topic, id, ["ls-files", "--others", "--exclude-standard", "-z"], signal)).split("\0").filter(Boolean);
    for (const name of untracked) { const file = files.find(file => file.path === name); if (file) diff += unifiedDiff(name, "", file.content); }
    return { ...record, files: files.map(file => ({ path: file.path, hash: file.hash, bytes: file.bytes })), treeHash, currentTestsPassed: !record.test?.invalidated && record.test?.treeHash === treeHash && record.test.status === "completed" && record.test.exitCode === 0, branch: `practice/${id}`, head, diff: diff.slice(0, 48_000), history, snapshots: this.snapshotList(topic, id) };
  }
  private async editState(topic: string, id: string, raw: ProjectEdit): Promise<{ input: ProjectEdit; before: ProjectFile | undefined }> {
    this.record(topic, id); const input = projectEditSchema.parse(raw); if (Buffer.byteLength(input.content) > 24_000 || input.content.includes("\0")) throw new Error("project_limit");
    let before: ProjectFile | undefined;
    try { before = await this.read(topic, id, input.path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if ((before?.hash ?? null) !== input.expectedHash && before?.content !== input.content) throw new Error("project_file_conflict");
    return { input, before };
  }
  async preview(topic: string, id: string, raw: ProjectEdit): Promise<string> { const { input, before } = await this.editState(topic, id, raw); return unifiedDiff(input.path, before?.content ?? "", input.content); }
  async write(topic: string, id: string, raw: ProjectEdit, signal: AbortSignal, receiptKey?: string): Promise<{ projectId: string; path: string; hash: string; treeHash: string; snapshotId: string | null }> {
    const input = projectEditSchema.parse(raw); const result = await this.writeMany(topic, id, [input], signal, receiptKey);
    return { projectId: id, path: input.path, hash: hash(input.content), treeHash: result.treeHash, snapshotId: result.snapshotId };
  }
  private snapshotList(topic: string, id: string) {
    this.initializeRevisions();
    return this.database.db.prepare("SELECT id,tree_hash AS treeHash,created_at AS createdAt FROM project_snapshots WHERE project=? AND topic=? ORDER BY rowid DESC LIMIT 20").all(id, topic) as { id: string; treeHash: string; createdAt: string }[];
  }
  private validateFiles(files: ProjectFile[]): void {
    const names = files.map(file => file.path.toLowerCase());
    if (new Set(names).size !== names.length || names.some(name => names.some(other => other !== name && other.startsWith(`${name}/`)))) throw new Error("project_path_collision");
    if (files.length > 40 || files.reduce((n, file) => n + file.bytes, 0) > 256_000) throw new Error("project_limit");
    for (const file of files) { projectPathSchema.parse(file.path); if (file.bytes !== Buffer.byteLength(file.content) || file.hash !== hash(file.content) || file.bytes > 24_000 || file.content.includes("\0")) throw new Error("project_limit"); }
  }
  private async batchState(topic: string, id: string, raw: ProjectBatch) {
    this.record(topic, id); const edits = projectBatchSchema.parse(raw); const before = await this.files(topic, id); this.validateFiles(before);
    if (new Set(edits.map(edit => edit.path.toLowerCase())).size !== edits.length) throw new Error("project_path_collision");
    const next = new Map(before.map(file => [file.path, file]));
    for (const edit of edits) {
      const previous = next.get(edit.path);
      if ((previous?.hash ?? null) !== edit.expectedHash && (previous?.content ?? null) !== edit.content) throw new Error("project_file_conflict");
      if (edit.content === null) next.delete(edit.path);
      else next.set(edit.path, { path: edit.path, content: edit.content, hash: hash(edit.content), bytes: Buffer.byteLength(edit.content) });
    }
    const after = [...next.values()].sort((a, b) => a.path.localeCompare(b.path)); this.validateFiles(after); return { before, after };
  }
  private diffFiles(before: ProjectFile[], after: ProjectFile[]): string {
    return [...new Set([...before, ...after].map(file => file.path))].sort().flatMap(name => {
      const a = before.find(file => file.path === name)?.content ?? ""; const b = after.find(file => file.path === name)?.content ?? "";
      return a === b ? [] : [unifiedDiff(name, a, b)];
    }).join("\n");
  }
  async previewMany(topic: string, id: string, edits: ProjectBatch): Promise<string> { await this.recover(topic, id); const { before, after } = await this.batchState(topic, id, edits); const diff = this.diffFiles(before, after); return diff.length > 47_900 ? `${diff.slice(0, 47_900)}\n[差异展示已截断]` : diff; }
  async writeMany(topic: string, id: string, edits: ProjectBatch, signal: AbortSignal, receiptKey?: string) {
    await this.recover(topic, id);
    return this.lease(id, async () => { const { before, after } = await this.batchState(topic, id, edits); return this.replaceFiles(topic, id, before, after, signal, receiptKey); });
  }
  async patchValue(topic: string, id: string, raw: z.infer<typeof projectPatchSchema>): Promise<ProjectEdit> {
    const input = projectPatchSchema.parse(raw); const file = await this.read(topic, id, input.path);
    if (file.hash !== input.expectedHash) throw new Error("project_file_conflict");
    return { path: input.path, expectedHash: input.expectedHash, content: applyReplacements(file.content, input.replacements) };
  }
  private async restoreState(topic: string, id: string, snapshotId: string, expectedTreeHash: string) {
    this.record(topic, id); z.string().uuid().parse(snapshotId); hashSchema.parse(expectedTreeHash); this.initializeRevisions();
    const row = this.database.db.prepare("SELECT files,tree_hash FROM project_snapshots WHERE id=? AND project=? AND topic=?").get(snapshotId, id, topic) as { files: string; tree_hash: string } | undefined;
    if (!row) throw new Error("project_snapshot_missing");
    const after = z.array(z.object({ path: projectPathSchema, content: z.string().max(24_000), bytes: z.number().int().nonnegative(), hash: hashSchema }).strict()).max(40).parse(JSON.parse(row.files)); this.validateFiles(after);
    if (this.treeHash(after) !== row.tree_hash) throw new Error("project_snapshot_invalid");
    const before = await this.files(topic, id); if (this.treeHash(before) !== expectedTreeHash) throw new Error("project_tree_conflict"); return { before, after };
  }
  async previewRestore(topic: string, id: string, snapshotId: string, expectedTreeHash: string): Promise<string> { await this.recover(topic, id); const state = await this.restoreState(topic, id, snapshotId, expectedTreeHash); const diff = this.diffFiles(state.before, state.after); return diff.length > 47_900 ? `${diff.slice(0, 47_900)}\n[差异展示已截断]` : diff; }
  async restore(topic: string, id: string, snapshotId: string, expectedTreeHash: string, signal: AbortSignal, receiptKey?: string) {
    await this.recover(topic, id); return this.lease(id, async () => { const state = await this.restoreState(topic, id, snapshotId, expectedTreeHash); return this.replaceFiles(topic, id, state.before, state.after, signal, receiptKey); });
  }
  private async replaceFiles(topic: string, id: string, before: ProjectFile[], after: ProjectFile[], signal: AbortSignal, receiptKey?: string) {
    this.initializeRevisions(); const beforeHash = this.treeHash(before); const treeHash = this.treeHash(after);
    const result = { projectId: id, treeHash, files: after.map(file => ({ path: file.path, hash: file.hash })), snapshotId: null as string | null };
    if (beforeHash === treeHash) return result;
    const snapshotId = randomUUID(); const area = `change-${snapshotId}`; const staging = this.directory(topic, id, area);
    await fs.mkdir(this.directory(topic, id, area, "next"), { recursive: true, mode: 0o700 });
    try {
      for (const file of after) { const target = this.directory(topic, id, area, "next", file.path); await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 }); await fs.writeFile(target, file.content, { flag: "wx", mode: 0o600, signal }); }
      if (this.treeHash(await this.files(topic, id)) !== beforeHash) throw new Error("project_tree_conflict"); signal.throwIfAborted();
      this.database.db.transaction(() => {
        this.database.db.prepare("INSERT INTO project_snapshots VALUES (?,?,?,?,?,?)").run(snapshotId, id, topic, beforeHash, JSON.stringify(before), new Date().toISOString());
        this.database.db.prepare("DELETE FROM project_snapshots WHERE project=? AND id NOT IN (SELECT id FROM project_snapshots WHERE project=? ORDER BY rowid DESC LIMIT 20)").run(id, id);
        this.database.db.prepare("INSERT INTO project_changes VALUES (?,?,?,?,?,?)").run(id, topic, snapshotId, beforeHash, treeHash, "prepared");
      })();
      await fs.rename(this.directory(topic, id, "files"), this.directory(topic, id, area, "before"));
      signal.throwIfAborted(); await fs.rename(this.directory(topic, id, area, "next"), this.directory(topic, id, "files"));
      if (this.treeHash(await this.files(topic, id)) !== treeHash) throw new Error("project_tree_conflict");
      result.snapshotId = snapshotId;
      this.database.db.transaction(() => {
        if (receiptKey) { hashSchema.parse(receiptKey); this.database.db.prepare("INSERT INTO project_mutation_receipts VALUES (?,?,?) ON CONFLICT(project,key) DO UPDATE SET result=excluded.result").run(id, receiptKey, JSON.stringify(result)); this.database.db.prepare("DELETE FROM project_mutation_receipts WHERE project=? AND rowid NOT IN (SELECT rowid FROM project_mutation_receipts WHERE project=? ORDER BY rowid DESC LIMIT 64)").run(id, id); }
        this.database.db.prepare("UPDATE project_changes SET state='committed' WHERE project=?").run(id);
        const record = this.record(topic, id); if (record.test) { record.test.invalidated = true; this.database.db.prepare("UPDATE practice_projects SET value=? WHERE id=?").run(JSON.stringify(record), id); }
        this.database.db.prepare("DELETE FROM project_snapshots WHERE project=? AND id NOT IN (SELECT id FROM project_snapshots WHERE project=? ORDER BY rowid DESC LIMIT 20)").run(id, id);
      })();
      result.snapshotId = snapshotId;
    } catch (error) { await this.recoverChange(topic, id); throw error; }
    finally {
      // A committed result stays committed if optional cleanup fails; the durable record lets the next access finish cleanup.
      if (!this.database.db.prepare("SELECT project FROM project_changes WHERE project=?").get(id)) await fs.rm(staging, { recursive: true, force: true });
    }
    try { await this.recoverChange(topic, id); } catch { /* Keep the committed receipt and owned staging for recovery. */ }
    return result;
  }
  async readReceipt(topic: string, id: string, key: string) {
    hashSchema.parse(key); await this.recover(topic, id);
    const row = this.database.db.prepare("SELECT result FROM project_mutation_receipts WHERE project=? AND key=?").get(id, key) as { result: string } | undefined;
    if (!row) return undefined;
    const receipt = z.object({ projectId: z.literal(id), treeHash: hashSchema, files: z.array(z.object({ path: projectPathSchema, hash: hashSchema })).max(40), snapshotId: z.string().uuid().nullable() }).parse(JSON.parse(row.result));
    if (this.treeHash(await this.files(topic, id)) !== receipt.treeHash) throw new Error("project_result_outdated");
    return receipt;
  }
  private async recover(topic: string, id: string): Promise<void> {
    this.initializeRevisions(); this.record(topic, id);
    if (this.database.db.prepare("SELECT project FROM project_changes WHERE project=?").get(id)) await this.lease(id, () => this.recoverChange(topic, id));
  }
  private async recoverChange(topic: string, id: string): Promise<void> {
    const row = this.database.db.prepare("SELECT * FROM project_changes WHERE project=? AND topic=?").get(id, topic) as { id: string; before_hash: string; after_hash: string; state: string } | undefined;
    if (!row) return; z.string().uuid().parse(row.id); const area = `change-${row.id}`;
    if (row.state === "prepared") {
      let current: string | null = null; try { current = this.treeHash(await this.files(topic, id)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      const original = this.directory(topic, id, area, "before"); const exists = await fs.lstat(original).then(() => true).catch(error => { if (error.code === "ENOENT") return false; throw error; });
      if (exists) {
        if (this.treeHash(await this.files(topic, id, `${area}/before`)) !== row.before_hash || current !== null && current !== row.after_hash) throw new Error("project_recovery_conflict");
        if (current !== null) await fs.rm(this.directory(topic, id, "files"), { recursive: true });
        await fs.rename(original, this.directory(topic, id, "files"));
      } else if (current !== row.before_hash) throw new Error("project_recovery_conflict");
    } else if (row.state !== "committed") throw new Error("project_recovery_conflict");
    await fs.rm(this.directory(topic, id, area), { recursive: true, force: true });
    this.database.db.prepare("DELETE FROM project_changes WHERE project=?").run(id);
  }
  async test(topic: string, id: string, expectedTreeHash: string, signal: AbortSignal): Promise<z.infer<typeof testSchema>> {
    await this.recover(topic, id);
    return this.lease(id, async () => {
      const record = this.record(topic, id); hashSchema.parse(expectedTreeHash); const files = await this.files(topic, id);
      if (this.treeHash(files) !== expectedTreeHash) throw new Error("project_tree_conflict");
      const tests = files.filter(file => file.path.endsWith(".test.mjs")).map(file => file.path);
      const python = files.filter(file => /(?:^|\/)test_[^/]+\.py$/.test(file.path)).map(file => file.path);
      if (!tests.length && !python.length) throw new Error("project_tests_required");
      const deadline = Date.now() + 10_000; const results = [];
      if (tests.length) {
        const executable = await fs.realpath(process.execPath); const electronNode = Boolean(process.versions.electron);
        results.push(await new LocalSandbox().run(executable, ["--test", "--test-isolation=none", ...tests], { files: Object.fromEntries(files.map(file => [file.path, file.content])), allowedCommands: [executable], timeoutMs: Math.max(1, deadline - Date.now()), signal, electronNode, ...(electronNode ? { runtimeReadPath: path.resolve(path.dirname(executable), "../Frameworks") } : {}) }));
      }
      if (python.length && !signal.aborted) results.push(await runPythonTests(Object.fromEntries(files.map(file => [file.path, file.content])), python, signal, Math.max(1, deadline - Date.now())));
      const result = { status: results.find(item => item.status !== "completed")?.status ?? "completed", exitCode: results.every(item => item.status === "completed" && item.exitCode === 0) ? 0 : results.find(item => item.exitCode !== 0)?.exitCode ?? null, stdout: results.map(item => item.stdout).join("\n"), stderr: results.map(item => item.stderr).join("\n") };
      const test = testSchema.parse({ ...result, stdout: result.stdout.slice(0, 64_000), stderr: result.stderr.slice(0, 64_000), id: randomUUID(), treeHash: expectedTreeHash, createdAt: new Date().toISOString() });
      this.database.db.prepare("UPDATE practice_projects SET value=? WHERE id=? AND topic=?").run(JSON.stringify({ ...record, test }), id, topic); return test;
    });
  }
  async checkpoint(topic: string, id: string, expectedTreeHash: string, title: string, signal: AbortSignal): Promise<{ projectId: string; treeHash: string; commit: string }> {
    await this.recover(topic, id);
    return this.lease(id, async () => {
      const record = this.record(topic, id); hashSchema.parse(expectedTreeHash); z.string().trim().min(1).max(120).regex(/^[^\r\n\0]+$/).parse(title);
      const files = await this.files(topic, id); if (this.treeHash(files) !== expectedTreeHash) throw new Error("project_tree_conflict");
      if (record.test?.invalidated || record.test?.treeHash !== expectedTreeHash || record.test.status !== "completed" || record.test.exitCode !== 0) throw new Error("project_tests_required");
      const commit = await this.commitTree(topic, id, files, title, signal, true);
      if (this.treeHash(await this.files(topic, id)) !== expectedTreeHash) throw new Error("project_tree_conflict");
      return { projectId: id, treeHash: expectedTreeHash, commit };
    });
  }
  private async commitTree(topic: string, id: string, files: ProjectFile[], title: string, signal: AbortSignal, exists: boolean): Promise<string> {
    // Rebuild the index from the bounded file list, never `git add .` or arbitrary paths.
    await this.git(topic, id, ["read-tree", "--empty"], signal);
    await this.git(topic, id, ["add", "--", ...files.map(file => file.path)], signal);
    const tree = (await this.git(topic, id, ["write-tree"], signal)).trim();
    const staged = (await this.git(topic, id, ["ls-tree", "-r", "-z", tree], signal)).split("\0").filter(Boolean);
    if (staged.length !== files.length || staged.some(line => {
      const [entry, name] = line.split("\t"); const file = files.find(file => file.path === name);
      const object = file ? createHash("sha1").update(`blob ${Buffer.byteLength(file.content)}\0`).update(file.content).digest("hex") : "";
      return entry !== `100644 blob ${object}`;
    })) throw new Error("project_tree_conflict");
    const previous = exists ? (await this.git(topic, id, ["rev-parse", "HEAD"], signal)).trim() : undefined;
    if (previous && (await this.git(topic, id, ["rev-parse", "HEAD^{tree}"], signal)).trim() === tree) return previous;
    const commit = (await this.git(topic, id, ["commit-tree", tree, ...(previous ? ["-p", previous] : []), "-m", title], signal)).trim();
    await this.git(topic, id, ["update-ref", `refs/heads/practice/${id}`, commit, previous ?? "0".repeat(40)], signal); return commit;
  }
  private async checkRepository(topic: string, id: string, signal = new AbortController().signal): Promise<void> {
    const repo = this.directory(topic, id, "repository.git"); let count = 0; let bytes = 0;
    const visit = async (relative: string): Promise<void> => {
      for (const entry of await fs.readdir(this.directory(topic, id, "repository.git", relative), { withFileTypes: true })) {
        signal.throwIfAborted(); if (++count > 10_000 || entry.isSymbolicLink()) throw new Error("project_git_invalid");
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        if (["objects/info/alternates", "objects/info/http-alternates", "info/grafts"].includes(name) || name.startsWith("refs/replace/")) throw new Error("project_git_invalid");
        if (entry.isDirectory()) await visit(name);
        else { const stat = await fs.lstat(this.directory(topic, id, "repository.git", name)); bytes += stat.size; if (!stat.isFile() || stat.nlink !== 1 || bytes > 64_000_000) throw new Error("project_git_invalid"); }
      }
    };
    await visit("");
    if ((await fs.stat(path.join(repo, "HEAD"))).size > 100 || await fs.readFile(this.directory(topic, id, "repository.git", "HEAD"), "utf8") !== `ref: refs/heads/practice/${id}\n`) throw new Error("project_git_invalid");
    if ((await fs.stat(path.join(repo, "config"))).size > 200 || await fs.readFile(this.directory(topic, id, "repository.git", "config"), "utf8") !== gitConfig) throw new Error("project_git_invalid");
  }
  private async git(topic: string, id: string, args: string[], signal: AbortSignal, initializing = false): Promise<string> {
    if (!initializing) await this.checkRepository(topic, id, signal); signal.throwIfAborted();
    const repo = this.directory(topic, id, "repository.git"); const directory = this.directory(topic, id, "files");
    const nullFile = process.platform === "win32" ? "NUL" : "/dev/null";
    try {
      const result = await exec(process.platform === "darwin" ? "/usr/bin/git" : "git", [...(!initializing ? [`--git-dir=${repo}`, `--work-tree=${directory}`] : []), "-c", "core.hooksPath=/dev/null", "-c", "core.fsmonitor=false", "-c", `core.attributesFile=${nullFile}`, "-c", "core.quotePath=false", "-c", "gc.auto=0", ...args], {
        cwd: directory, signal, timeout: 5000, maxBuffer: 512_000, encoding: "utf8", windowsHide: true,
        env: { PATH: process.platform === "win32" ? process.env.PATH : "/usr/bin:/bin", ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}), GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: nullFile, GIT_CONFIG_SYSTEM: nullFile, GIT_ATTR_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_AUTHOR_NAME: "Zhixing", GIT_AUTHOR_EMAIL: "practice@zhixing.invalid", GIT_COMMITTER_NAME: "Zhixing", GIT_COMMITTER_EMAIL: "practice@zhixing.invalid", LANG: "C.UTF-8" },
      }); return result.stdout;
    } catch { signal.throwIfAborted(); throw new Error("project_git_unavailable"); }
  }
  async validateBackup(): Promise<void> {
    for (const row of this.database.db.prepare("SELECT id,topic FROM practice_projects").all() as { id: string; topic: string }[]) { await this.recover(row.topic, row.id); await this.files(row.topic, row.id); await this.checkRepository(row.topic, row.id); }
  }
  async verifyOperation(topic: string, tool: string, input: Record<string, unknown>, result: Record<string, unknown>): Promise<boolean> {
    try {
      const id = z.string().uuid().parse(input.projectId);
      if (tool === "project_edit" || tool === "project_patch") return (await this.read(topic, id, String(input.path))).hash === (result.hash ?? (result.files as { path: string; hash: string }[] | undefined)?.find(file => file.path === input.path)?.hash);
      const snapshot = await this.snapshot(topic, id);
      if (["project_edit_many", "project_restore"].includes(tool)) return snapshot.treeHash === result.treeHash;
      if (snapshot.treeHash !== result.treeHash || !snapshot.currentTestsPassed) return false;
      if (tool === "project_test") return result.status === "completed" && result.exitCode === 0 && snapshot.test?.id === result.id;
      return tool === "project_checkpoint" && snapshot.head === result.commit;
    } catch { return false; }
  }
}
