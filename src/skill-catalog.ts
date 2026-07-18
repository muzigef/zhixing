import fs from "node:fs/promises";
import path from "node:path";
import type { TopicId } from "./contracts.js";

export interface SkillSummary { readonly name: string; readonly description: string; readonly path: string; readonly scope: "shared" | "topic"; }

/** Loads only shared and requested-topic Markdown skills; invalid files fail closed. */
export class SkillCatalog {
  readonly #cache = new Map<TopicId, SkillSummary[]>();

  constructor(private readonly root: string) {}

  async list(topicId: TopicId): Promise<SkillSummary[]> {
    try {
      const shared = await loadDirectory(path.join(this.root, "skills", "shared"), "shared");
      const topic = await loadDirectory(path.join(this.root, "skills", topicId), "topic");
      const all = [...shared, ...topic];
      const duplicates = all.filter((skill, index) => all.findIndex((item) => item.name === skill.name) !== index);
      if (duplicates.length) throw new Error(`skill_schema_invalid: 重复 skill ${duplicates[0]?.name}`);
      this.#cache.set(topicId, all);
      return all;
    } catch (error) {
      const previous = this.#cache.get(topicId);
      if (previous) return previous;
      throw error;
    }
  }

  async read(topicId: TopicId, name: string): Promise<string> {
    const skill = (await this.list(topicId)).find((item) => item.name === name);
    if (!skill) throw new Error("skill_not_found");
    const content = await fs.readFile(skill.path, "utf8");
    return content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  }
}

async function loadDirectory(directory: string, scope: SkillSummary["scope"]): Promise<SkillSummary[]> {
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const file = path.join(directory, entry.name, "SKILL.md");
      return parseSkill(file, scope);
    }));
    return files;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}

async function parseSkill(file: string, scope: SkillSummary["scope"]): Promise<SkillSummary> {
  let content: string;
  try { content = await fs.readFile(file, "utf8"); } catch { throw new Error(`skill_schema_invalid: 缺少 ${file}`); }
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]+)/.exec(content);
  const frontmatter = match?.[1];
  const body = match?.[2];
  if (!frontmatter || !body?.trim()) throw new Error(`skill_schema_invalid: ${file}`);
  const name = /^name:\s*['"]?([^'"\n]+)['"]?\s*$/m.exec(frontmatter)?.[1]?.trim();
  const description = /^description:\s*['"]?([^'"\n]+)['"]?\s*$/m.exec(frontmatter)?.[1]?.trim();
  if (!name || !description) throw new Error(`skill_schema_invalid: ${file}`);
  return { name, description, path: file, scope };
}
