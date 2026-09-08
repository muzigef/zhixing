import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PathPolicy } from "./paths.js";
const exec = promisify(execFile);
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
import { buildProvenanceSchema, type BuildProvenance } from "./build-provenance-contracts.js";
export { buildProvenanceSchema, type BuildProvenance } from "./build-provenance-contracts.js";
const roots = ["src", "tests", "skills", "topics", "desktop/core", "desktop/electron", "desktop/renderer", "desktop/scripts", "scripts", ".github/workflows"];
const singles = ["package.json", "package-lock.json", "tsconfig.json", "eslint.config.js", "AGENTS.md", "desktop/package.json", "desktop/package-lock.json", "desktop/tsconfig.json", "desktop/runtime-AGENTS.md", ".pi/extensions/zhixing-guard.ts", "docs/agent-quality-cases.json", "docs/agent-quality-heldout.json"];
/** Explicit source roots exclude user workspaces, credentials, dependencies, builds and generated reports. */
export async function sourceProvenance(root: string, kind: BuildProvenance["kind"] = "source_snapshot"): Promise<BuildProvenance> {
  const policy = new PathPolicy(root); const files: BuildProvenance["files"] = [];
  const visit = async (name: string): Promise<void> => {
    const target = policy.resolveWorkspacePath(...name.split("/")); let stat;
    try { stat = await fs.lstat(target); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return; throw error; }
    if (stat.isSymbolicLink() || !stat.isDirectory() && (!stat.isFile() || stat.nlink !== 1 || stat.size > 5_000_000)) throw new Error("provenance_source_invalid");
    if (stat.isDirectory()) {
      for (const entry of (await fs.readdir(target)).sort()) {
        if (/^(?:\.env(?:\..*)?|auth\.json|\.ssh|\.codex|node_modules|build|dist|credentials?(?:\..*)?|tokens?(?:\..*)?)$/i.test(entry)) continue;
        await visit(`${name}/${entry}`);
      }
    } else { if (files.length >= 2000) throw new Error("provenance_source_limit"); files.push({ path: name, sha256: hash(await fs.readFile(target)) }); }
  };
  for (const name of [...roots, ...singles]) await visit(name);
  files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  let commit: string | null = null; let dirty: boolean | null = null;
  try {
    const head = await exec("git", ["rev-parse", "HEAD"], { cwd: root, timeout: 2000, maxBuffer: 4000 });
    if (/^[a-f0-9]{40,64}$/.test(head.stdout.trim())) commit = head.stdout.trim();
    dirty = Boolean((await exec("git", ["status", "--porcelain", "--", ...roots, ...singles], { cwd: root, timeout: 2000, maxBuffer: 128_000 })).stdout.trim());
  } catch { /* Non-repository source snapshots still have exact content hashes. */ }
  return buildProvenanceSchema.parse({ version: 1, kind, codeHash: hash(JSON.stringify(files)), files, commit, dirty, capturedAt: new Date().toISOString(), node: process.version, platform: `${process.platform}-${process.arch}` });
}
export async function readBuildProvenance(resources: string): Promise<BuildProvenance> {
  const file = new PathPolicy(resources).resolveWorkspacePath("build-provenance.json");
  try { if ((await fs.stat(file)).size > 1_000_000) throw new Error("provenance_source_limit"); return buildProvenanceSchema.parse(JSON.parse(await fs.readFile(file, "utf8"))); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return sourceProvenance(resources); throw error; }
}
