import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import { PathPolicy } from "./paths.js";
import { topicIdSchema } from "./contracts.js";
import type { ZhixingDatabase } from "./database.js";
import { LocalSandbox } from "./local-sandbox.js";

const exec = promisify(execFile);
const hash = (text: string | Buffer) => createHash("sha256").update(text).digest("hex");
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const privateFile = /^(?:auth\.json|credentials?(?:\..*)?|tokens?(?:\..*)?|secrets?(?:\..*)?|package-lock\.json)$/i;
export const projectPathSchema = z.string().max(300).regex(/^(?:[a-zA-Z0-9_-]{1,64}\/){0,4}[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}\.(?:mjs|js|json|md|txt)$/).refine(value => value.split("/").every(part => !privateFile.test(part)));
export const projectEditSchema = z.object({ path: projectPathSchema, expectedHash: hashSchema.nullable(), content: z.string().max(24_000) }).strict();
export type ProjectEdit = z.infer<typeof projectEditSchema>;
const testSchema = z.object({ id: z.string().uuid(), treeHash: hashSchema, status: z.enum(["completed", "timed_out", "unavailable", "cancelled"]), stdout: z.string().max(64_000), stderr: z.string().max(64_000), exitCode: z.number().int().nullable(), createdAt: z.string().datetime() });
const recordSchema = z.object({ id: z.string().uuid(), topicId: topicIdSchema, title: z.string().min(1).max(80), createdAt: z.string().datetime(), test: testSchema.optional() });
type ProjectRecord = z.infer<typeof recordSchema>;
const gitConfig = "[core]\n\trepositoryformatversion = 0\n\tbare = true\n\tfilemode = false\n";
const starter = {
  "README.md": "# 实践项目\n\n这是独立的练习目录。修改实现和测试后运行项目测试，再保存 Git 检查点。测试通过只说明这些测试通过，不等于已掌握知识。\n",
  "src/implementation.mjs": "export const solve = value => value;\n",
  "test/implementation.test.mjs": "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { solve } from '../src/implementation.mjs';\ntest('returns the supplied value', () => assert.equal(solve(42), 42));\n",
};
type ProjectFile = { path: string; content: string; hash: string; bytes: number };
export type ProjectSnapshot = ProjectRecord & { files: Omit<ProjectFile, "content">[]; treeHash: string; currentTestsPassed: boolean; branch: string; head: string; diff: string; history: { commit: string; title: string }[] };

/** A managed directory and separate bare Git repository per practice project. */
export class PracticeProjects {
  private readonly paths: PathPolicy;
  constructor(private readonly root: string, private readonly database: ZhixingDatabase) {
    this.paths = new PathPolicy(root);
    database.db.exec("CREATE TABLE IF NOT EXISTS practice_projects(id TEXT PRIMARY KEY,topic TEXT NOT NULL,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS practice_selection(topic TEXT PRIMARY KEY,id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS practice_leases(id TEXT PRIMARY KEY,lease TEXT NOT NULL,pid INTEGER NOT NULL)");
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
  async create(topic: string, title: string, signal: AbortSignal, selectedDirectory?: string): Promise<ProjectSnapshot> {
    const record = recordSchema.parse({ id: randomUUID(), topicId: topic, title: title.trim(), createdAt: new Date().toISOString() });
    if (this.list(topic).length >= 20) throw new Error("project_limit");
    const files = selectedDirectory ? await this.importFiles(selectedDirectory, signal) : starter;
    if (!Object.keys(files).length) throw new Error("project_empty"); signal.throwIfAborted();
    const directory = this.directory(topic, record.id); await fs.mkdir(this.directory(topic, record.id, "files"), { recursive: true, mode: 0o700 });
    try {
      for (const [name, content] of Object.entries(files)) { const target = this.directory(topic, record.id, "files", name); await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 }); await fs.writeFile(target, content, { flag: "wx", mode: 0o600, signal }); }
      await this.git(topic, record.id, ["init", "--bare", `--initial-branch=practice/${record.id}`, "--template=", this.directory(topic, record.id, "repository.git")], signal, true);
      await fs.writeFile(this.directory(topic, record.id, "repository.git", "config"), gitConfig, { mode: 0o600 });
      const captured = await this.files(topic, record.id);
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
  async read(topic: string, id: string, name: string): Promise<ProjectFile> { this.record(topic, id); projectPathSchema.parse(name); return this.readFile(this.directory(topic, id, "files", name), name); }
  private async files(topic: string, id: string): Promise<ProjectFile[]> {
    const result: ProjectFile[] = []; let total = 0; let entries = 0;
    const visit = async (relative: string): Promise<void> => {
      for (const entry of await fs.readdir(this.directory(topic, id, "files", relative), { withFileTypes: true })) {
        if (++entries > 200) throw new Error("project_limit");
        const name = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) throw new Error("project_link_denied");
        if (entry.isDirectory()) { if (!/^(?:[a-zA-Z0-9_-]{1,64}\/){0,3}[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new Error("project_file_denied"); await visit(name); }
        else { projectPathSchema.parse(name); const file = await this.readFile(this.directory(topic, id, "files", name), name); result.push(file); total += file.bytes; if (result.length > 40 || total > 256_000) throw new Error("project_limit"); }
      }
    };
    await visit(""); return result.sort((a, b) => a.path.localeCompare(b.path));
  }
  private treeHash(files: ProjectFile[]): string { return hash(JSON.stringify(files.map(file => [file.path, file.hash]))); }
  async snapshot(topic: string, id: string, signal = new AbortController().signal): Promise<ProjectSnapshot> {
    const record = this.record(topic, id); const files = await this.files(topic, id); const treeHash = this.treeHash(files); signal.throwIfAborted();
    const head = (await this.git(topic, id, ["rev-parse", "HEAD"], signal)).trim();
    const history = (await this.git(topic, id, ["log", "-20", "--format=%H%x09%s"], signal)).trim().split("\n").filter(Boolean).map(line => { const [commit, ...title] = line.split("\t"); return { commit: commit!, title: title.join("\t") }; });
    let diff = await this.git(topic, id, ["diff", "--no-ext-diff", "--no-textconv", "HEAD", "--", "."], signal);
    const untracked = (await this.git(topic, id, ["ls-files", "--others", "--exclude-standard", "-z"], signal)).split("\0").filter(Boolean);
    for (const name of untracked) { const file = files.find(file => file.path === name); if (file) diff += unifiedDiff(name, "", file.content); }
    return { ...record, files: files.map(file => ({ path: file.path, hash: file.hash, bytes: file.bytes })), treeHash, currentTestsPassed: record.test?.treeHash === treeHash && record.test.status === "completed" && record.test.exitCode === 0, branch: `practice/${id}`, head, diff: diff.slice(0, 48_000), history };
  }
  private async editState(topic: string, id: string, raw: ProjectEdit): Promise<{ input: ProjectEdit; before: ProjectFile | undefined }> {
    this.record(topic, id); const input = projectEditSchema.parse(raw); if (Buffer.byteLength(input.content) > 24_000 || input.content.includes("\0")) throw new Error("project_limit");
    let before: ProjectFile | undefined;
    try { before = await this.read(topic, id, input.path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    if ((before?.hash ?? null) !== input.expectedHash && before?.content !== input.content) throw new Error("project_file_conflict");
    return { input, before };
  }
  async preview(topic: string, id: string, raw: ProjectEdit): Promise<string> { const { input, before } = await this.editState(topic, id, raw); return unifiedDiff(input.path, before?.content ?? "", input.content); }
  async write(topic: string, id: string, raw: ProjectEdit, signal: AbortSignal): Promise<{ projectId: string; path: string; hash: string; treeHash: string }> {
    return this.lease(id, async () => {
      const { input, before } = await this.editState(topic, id, raw); const files = await this.files(topic, id);
      if (files.length + (before ? 0 : 1) > 40 || files.reduce((n, file) => n + file.bytes, 0) - (before?.bytes ?? 0) + Buffer.byteLength(input.content) > 256_000) throw new Error("project_limit");
      if (before?.content !== input.content) {
        signal.throwIfAborted(); const target = this.directory(topic, id, "files", input.path); await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
        const temporary = this.directory(topic, id, `write-${randomUUID()}.tmp`);
        try { await fs.writeFile(temporary, input.content, { flag: "wx", mode: 0o600, signal }); await this.editState(topic, id, input); signal.throwIfAborted(); await fs.rename(temporary, this.directory(topic, id, "files", input.path)); }
        finally { await fs.rm(temporary, { force: true }); }
      }
      return { projectId: id, path: input.path, hash: hash(input.content), treeHash: this.treeHash(await this.files(topic, id)) };
    });
  }
  async test(topic: string, id: string, expectedTreeHash: string, signal: AbortSignal): Promise<z.infer<typeof testSchema>> {
    return this.lease(id, async () => {
      const record = this.record(topic, id); hashSchema.parse(expectedTreeHash); const files = await this.files(topic, id);
      if (this.treeHash(files) !== expectedTreeHash) throw new Error("project_tree_conflict");
      const tests = files.filter(file => file.path.endsWith(".test.mjs")).map(file => file.path); if (!tests.length) throw new Error("project_tests_required");
      const executable = await fs.realpath(process.execPath); const electronNode = Boolean(process.versions.electron);
      const result = await new LocalSandbox().run(executable, ["--test", "--test-isolation=none", ...tests], { files: Object.fromEntries(files.map(file => [file.path, file.content])), allowedCommands: [executable], timeoutMs: 10_000, signal, electronNode, ...(electronNode ? { runtimeReadPath: path.resolve(path.dirname(executable), "../Frameworks") } : {}) });
      const test = testSchema.parse({ ...result, stdout: result.stdout.slice(0, 64_000), stderr: result.stderr.slice(0, 64_000), id: randomUUID(), treeHash: expectedTreeHash, createdAt: new Date().toISOString() });
      this.database.db.prepare("UPDATE practice_projects SET value=? WHERE id=? AND topic=?").run(JSON.stringify({ ...record, test }), id, topic); return test;
    });
  }
  async checkpoint(topic: string, id: string, expectedTreeHash: string, title: string, signal: AbortSignal): Promise<{ projectId: string; treeHash: string; commit: string }> {
    return this.lease(id, async () => {
      const record = this.record(topic, id); hashSchema.parse(expectedTreeHash); z.string().trim().min(1).max(120).regex(/^[^\r\n\0]+$/).parse(title);
      const files = await this.files(topic, id); if (this.treeHash(files) !== expectedTreeHash) throw new Error("project_tree_conflict");
      if (record.test?.treeHash !== expectedTreeHash || record.test.status !== "completed" || record.test.exitCode !== 0) throw new Error("project_tests_required");
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
    for (const row of this.database.db.prepare("SELECT id,topic FROM practice_projects").all() as { id: string; topic: string }[]) { await this.files(row.topic, row.id); await this.checkRepository(row.topic, row.id); }
  }
  async verifyOperation(topic: string, tool: string, input: Record<string, unknown>, result: Record<string, unknown>): Promise<boolean> {
    try {
      const id = z.string().uuid().parse(input.projectId);
      if (tool === "project_edit") return (await this.read(topic, id, String(input.path))).hash === result.hash;
      const snapshot = await this.snapshot(topic, id);
      if (snapshot.treeHash !== result.treeHash || !snapshot.currentTestsPassed) return false;
      if (tool === "project_test") return result.status === "completed" && result.exitCode === 0 && snapshot.test?.id === result.id;
      return tool === "project_checkpoint" && snapshot.head === result.commit;
    } catch { return false; }
  }
}
function unifiedDiff(name: string, before: string, after: string): string {
  if (before === after) return "文件内容没有变化。";
  const lines = (text: string) => text ? (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n") : [];
  const oldLines = lines(before); const newLines = lines(after);
  const side = (items: string[], original: string, prefix: string) => [...items.map(line => `${prefix}${line}`), ...(original && !original.endsWith("\n") ? ["\\ No newline at end of file"] : [])];
  return [`--- a/${name}`, `+++ b/${name}`, `@@ -${oldLines.length ? 1 : 0},${oldLines.length} +${newLines.length ? 1 : 0},${newLines.length} @@`, ...side(oldLines, before, "-"), ...side(newLines, after, "+")].join("\n").slice(0, 48_000);
}
