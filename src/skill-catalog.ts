import { createHash } from "node:crypto";
import { parseDocument } from "yaml";
import { z } from "zod/v4";
import fs from "node:fs/promises";
import path from "node:path";
import type { TopicId } from "./contracts.js";
import { topicIdSchema } from "./contracts.js";
import { PathPolicy } from "./paths.js";

export interface SkillSummary { readonly name: string; readonly description: string; readonly path: string; readonly scope: "shared" | "topic"; readonly version?: string; readonly contentHash: string; readonly conditions: string[]; readonly evaluations: string[]; readonly status: "current" | "stale"; readonly fallbackReason?: "catalog_unavailable"; }
export function skillMetadata(skill: SkillSummary): Omit<SkillSummary, "path"> {
  const { name, description, scope, version, contentHash, conditions, evaluations, status, fallbackReason } = skill;
  return { name, description, scope, version, contentHash, conditions, evaluations, status, fallbackReason };
}
export interface SkillDetails extends SkillSummary { workflow: string; authority: "reference_only"; }

/** Loads only shared and requested-topic Markdown skills; invalid files fail closed. */
export class SkillCatalog {
  readonly #cache = new Map<TopicId, SkillSummary[]>();
  readonly #bodies = new Map<TopicId, Map<string, string>>();

  constructor(private readonly root: string) {}

  async list(topicId: TopicId): Promise<SkillSummary[]> {
    topicIdSchema.parse(topicId);
    try {
      const paths = new PathPolicy(this.root);
      const shared = await loadDirectory(paths.resolveWorkspacePath("skills", "shared"), "shared", paths);
      const topic = await loadDirectory(paths.resolveWorkspacePath("skills", topicId), "topic", paths);
      const all = [...shared, ...topic];
      const duplicates = all.filter((skill, index) => all.findIndex((item) => item.name === skill.name) !== index);
      if (duplicates.length) throw new Error(`skill_schema_invalid: 重复 skill ${duplicates[0]?.name}`);
      const summaries = all.map(skill => ({ ...skillMetadata(skill), path: skill.path }));
      this.#bodies.set(topicId, new Map(all.map((skill) => [skill.name, skill.content])));
      this.#cache.set(topicId, summaries);
      return structuredClone(summaries);
    } catch (error) {
      const previous = this.#cache.get(topicId);
      if (previous) return structuredClone(previous.map(item => ({ ...item, status: "stale" as const, fallbackReason: "catalog_unavailable" as const })));
      throw error;
    }
  }

  async details(topicId: TopicId, name: string): Promise<SkillDetails> {
    const skill = (await this.list(topicId)).find(item => item.name === name);
    if (!skill) throw new Error("skill_not_found");
    const content = this.#bodies.get(topicId)?.get(name); if (!content) throw new Error("skill_not_found");
    return { ...skill, workflow: content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim(), authority: "reference_only" };
  }
  async page(topicId: TopicId, name: string, offset = 0, expectedHash?: string) {
    z.number().int().min(0).max(64_000).parse(offset);
    const skill = await this.details(topicId, name);
    if (offset > 0 && !expectedHash || expectedHash && expectedHash !== skill.contentHash) throw new Error("skill_version_mismatch");
    if (offset > skill.workflow.length) throw new Error("skill_offset_invalid");
    let end = Math.min(offset + 5000, skill.workflow.length); if (end < skill.workflow.length && /[\uD800-\uDBFF]/.test(skill.workflow[end - 1]!)) end--;
    return { ...skillMetadata(skill), authority: skill.authority, workflow: skill.workflow.slice(offset, end), totalChars: skill.workflow.length, nextOffset: end < skill.workflow.length ? end : null };
  }
  async read(topicId: TopicId, name: string): Promise<string> { return (await this.details(topicId, name)).workflow; }

}

async function loadDirectory(directory: string, scope: SkillSummary["scope"], paths: PathPolicy): Promise<(SkillSummary & { content: string })[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    if (entries.length > 100) throw new Error("skill_catalog_limit");
    const files = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const file = paths.resolveWorkspacePath(...path.relative(paths.root, directory).split(path.sep), entry.name, "SKILL.md");
      return parseSkill(file, scope);
    }));
    return files;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function parseSkill(file: string, scope: SkillSummary["scope"]): Promise<SkillSummary & { content: string }> {
  let content: string;
  try { const handle = await fs.open(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0)); try { if ((await handle.stat()).size > 64_000) throw new Error("skill_size_limit"); content = await handle.readFile("utf8"); } finally { await handle.close(); } } catch { throw new Error(`skill_schema_invalid: 无法读取 ${file}`); }
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)/.exec(content);
  if (!match?.[1] || !match[2]?.trim()) throw new Error("skill_schema_invalid");
  const document = parseDocument(match[1], { uniqueKeys: true });
  if (document.errors.length) throw new Error("skill_schema_invalid");
  const metadata = z.object({
    name: z.string().trim().min(1).max(100), description: z.string().trim().min(1).max(1000),
    version: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,39}$/).optional(),
    conditions: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
    evaluations: z.array(z.string().regex(/^(?:quality:[A-Z][0-9]{2}|test:[a-z0-9/_-]{1,100})$/)).max(20).default([]),
  }).safeParse(document.toJS({ maxAliasCount: 0 }));
  if (!metadata.success) throw new Error("skill_schema_invalid");
  return { ...metadata.data, path: file, scope, content, contentHash: createHash("sha256").update(content).digest("hex"), status: "current" };
}
