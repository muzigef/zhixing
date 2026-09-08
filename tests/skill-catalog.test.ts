import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SkillCatalog } from "../src/skill-catalog.js";

const roots: string[] = [];
async function root(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-skills-"));
  roots.push(directory);
  return directory;
}
async function skill(directory: string, scope: string, name: string, body = "# Steps\n"): Promise<void> {
  const target = path.join(directory, "skills", scope, name, "SKILL.md");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `---\nname: ${name}\ndescription: ${name} description\n---\n${body}`, "utf8");
}
afterEach(async () => { await Promise.all(roots.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true }))); });

describe("skill catalog", () => {
  it("只加载 shared 与当前 topic skill", async () => {
    const directory = await root();
    await skill(directory, "shared", "tutor");
    await skill(directory, "rag", "grounding");
    await skill(directory, "tool-calling", "contract");
    const catalog = new SkillCatalog(directory);
    await expect(catalog.list("rag")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "tutor", scope: "shared" }),
      expect.objectContaining({ name: "grounding", scope: "topic" }),
    ]));
    expect((await catalog.list("rag")).map((item) => item.name)).not.toContain("contract");
    await expect(catalog.read("rag", "grounding")).resolves.toContain("# Steps");
  });

  it("已加载 catalog 遇到坏文件时保留上一版本", async () => {
    const directory = await root();
    await skill(directory, "rag", "stable");
    const catalog = new SkillCatalog(directory);
    await expect(catalog.list("rag")).resolves.toHaveLength(1);
    const file = path.join(directory, "skills", "rag", "stable", "SKILL.md");
    await fs.writeFile(file, "invalid", "utf8");
    await expect(catalog.list("rag")).resolves.toEqual([expect.objectContaining({ name: "stable" })]);
    await expect(catalog.read("rag", "stable")).resolves.toContain("# Steps");
    const stale = await catalog.details("rag", "stable");
    expect(stale).toMatchObject({ status: "stale", fallbackReason: "catalog_unavailable", authority: "reference_only" });
    expect(stale.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("binds workflow versions, conditions and evaluation links to actual file bytes", async () => {
    const directory = await root(); await skill(directory, "rag", "versioned");
    const file = path.join(directory, "skills/rag/versioned/SKILL.md");
    await fs.writeFile(file, '---\nname: versioned\ndescription: A versioned workflow\nversion: "1.0"\nconditions: [需要核对资料]\nevaluations: ["quality:R04"]\n---\n第一版流程');
    const catalog = new SkillCatalog(directory); const first = await catalog.details("rag", "versioned");
    expect(first).toMatchObject({ version: "1.0", status: "current", conditions: ["需要核对资料"], evaluations: ["quality:R04"], authority: "reference_only", workflow: "第一版流程" });
    await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace("第一版流程", "修改后的流程"));
    const next = await catalog.details("rag", "versioned"); expect(next.contentHash).not.toBe(first.contentHash);
    await expect(catalog.page("rag", "versioned", 1, first.contentHash)).rejects.toThrow("skill_version_mismatch");
    await fs.writeFile(file, '---\nname: one\nname: two\ndescription: invalid duplicate\n---\n不要使用');
    expect(await catalog.details("rag", "versioned")).toMatchObject({ contentHash: next.contentHash, status: "stale", workflow: "修改后的流程" });
  });

  it("坏 frontmatter 失败关闭", async () => {
    const directory = await root();
    await skill(directory, "rag", "bad", "");
    await expect(new SkillCatalog(directory).list("rag")).rejects.toThrow("skill_schema_invalid");
  });
  it("rejects linked roots and out-of-topic requests before reading skill bodies", async () => {
    const directory = await root(); const outside = await root(); await skill(outside, "shared", "private");
    await fs.mkdir(path.join(directory, "skills")); await fs.symlink(path.join(outside, "skills/shared"), path.join(directory, "skills/shared"), "dir");
    await expect(new SkillCatalog(directory).list("rag")).rejects.toThrow();
    await expect(new SkillCatalog(directory).list("../shared")).rejects.toThrow();
  });
});
