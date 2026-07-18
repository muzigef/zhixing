import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LearningProfileStore } from "../src/learning-profile.js";
import { GeneratedSkillStore } from "../src/generated-skill-store.js";
import { PathPolicy } from "../src/paths.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe("personal learning workflow", () => {
  it("stores a local profile and creates a confirmation-gated plan draft", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-personal-"));
    roots.push(root);
    const store = new LearningProfileStore(new PathPolicy(root));
    await store.save("rag", { goal: "掌握 RAG 面试", level: "初学", dailyMinutes: 45, totalDays: 14 });
    const draft = await store.proposePlan("rag");
    expect(draft).toMatch(/^personal-plan-/);
    await expect(fs.readFile(path.join(root, "learning-notes", "topics", "rag", "plans", `${draft}.md`), "utf8")).resolves.toContain("状态：待确认");
    await store.activatePlan("rag", draft);
    await expect(fs.readFile(path.join(root, "learning-notes", "topics", "rag", "ACTIVE_PERSONAL_PLAN.md"), "utf8")).resolves.toContain("状态：已启用");
  });

  it("creates a bounded skill draft and requires explicit activation before catalog exposure", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-personal-"));
    roots.push(root);
    const skills = new GeneratedSkillStore(root, new PathPolicy(root));
    await skills.createDraft("rag", "rag-interview", { goal: "掌握 RAG 面试", level: "初学", dailyMinutes: 45, totalDays: 14 });
    expect(await skills.listDrafts("rag")).toEqual(["rag-interview"]);
    await expect(fs.access(path.join(root, "skills", "rag", "rag-interview", "SKILL.md"))).rejects.toThrow();
    await skills.activate("rag", "rag-interview");
    await expect(fs.readFile(path.join(root, "skills", "rag", "rag-interview", "SKILL.md"), "utf8")).resolves.toContain("name: rag-interview");
  });
});
