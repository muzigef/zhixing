import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CustomCourseStore } from "../src/custom-course-store.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
describe("custom course store", () => {
  it("creates a draft and preserves the prior plan when explicitly activated", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-course-")); roots.push(root);
    const store = new CustomCourseStore(root, () => new Date("2026-07-18T00:00:00.000Z"));
    const version = await store.propose("3dgs", "3DGS", { goal: "跑通复现", level: "初学", dailyMinutes: 60, totalDays: 3 });
    const plan = path.join(root, "zhixing", "topics", "3dgs", "PLAN.md");
    await fs.mkdir(path.dirname(plan), { recursive: true }); await fs.writeFile(plan, "old plan", "utf8");
    await store.activate("3dgs", version);
    await expect(fs.readFile(plan, "utf8")).resolves.toContain("D03");
    await expect(fs.readFile(path.join(root, "learning-notes", "topics", "3dgs", "plans", `before-${version}.md`), "utf8")).resolves.toBe("old plan");
  });

  it("keeps the full requested duration instead of truncating a long course", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-course-")); roots.push(root);
    const store = new CustomCourseStore(root, () => new Date("2026-07-18T00:00:00.000Z"));
    const version = await store.propose("3dgs", "3DGS", { goal: "完成项目", level: "初学", dailyMinutes: 120, totalDays: 84 });
    await expect(fs.readFile(path.join(root, "learning-notes", "topics", "3dgs", "courses", `${version}.md`), "utf8")).resolves.toContain("D84");
  });
});
