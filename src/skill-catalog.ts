import fs from "node:fs/promises";
import path from "node:path";
import type { TopicId } from "./contracts.js";
import { topicIdSchema } from "./contracts.js";
import { PathPolicy } from "./paths.js";

export interface SkillSummary { readonly name: string; readonly description: string; readonly path: string; readonly scope: "shared" | "topic"; }

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
      const summaries = all.map(({ name, description, path, scope }) => ({ name, description, path, scope }));
      this.#bodies.set(topicId, new Map(all.map((skill) => [skill.name, skill.content])));
      this.#cache.set(topicId, summaries);
      return summaries;
    } catch (error) {
      const previous = this.#cache.get(topicId);
      if (previous) return previous;
      throw error;
    }
  }

  async read(topicId: TopicId, name: string): Promise<string> {
    const skill = (await this.list(topicId)).find((item) => item.name === name);
    if (!skill) throw new Error("skill_not_found");
    const content = this.#bodies.get(topicId)?.get(name);
    if (!content) throw new Error("skill_not_found");
    return content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  }
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
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]+)/.exec(content);
  const frontmatter = match?.[1];
  const body = match?.[2];
  if (!frontmatter || !body?.trim()) throw new Error(`skill_schema_invalid: ${file}`);
  const name = /^name:\s*['"]?([^'"\n]+)['"]?\s*$/m.exec(frontmatter)?.[1]?.trim();
  const description = /^description:\s*['"]?([^'"\n]+)['"]?\s*$/m.exec(frontmatter)?.[1]?.trim();
  if (!name || !description) throw new Error(`skill_schema_invalid: ${file}`);
  if (name.length > 100 || description.length > 1000) throw new Error("skill_schema_invalid");
  return { name, description, path: file, scope, content };
}
