import fs from "node:fs/promises";
import path from "node:path";
import type { TopicId } from "./contracts.js";
import type { LearningProfile } from "./learning-profile.js";

/** Creates local course drafts and preserves the previous topic plan on explicit activation. */
export class CustomCourseStore {
  constructor(private readonly root: string, private readonly now: () => Date = () => new Date()) {}

  async propose(topicId: TopicId, title: string, profile: LearningProfile): Promise<string> {
    const version = `course-${this.now().toISOString().replace(/[:.]/g, "-")}`;
    const file = path.join(this.root, "learning-notes", "topics", topicId, "courses", `${version}.md`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, coursePlan(topicId, title, profile), { encoding: "utf8", flag: "wx" });
    return version;
  }

  async activate(topicId: TopicId, version: string): Promise<void> {
    if (!/^course-[\dTZ-]+$/.test(version)) throw new Error("invalid_course_version");
    const source = path.join(this.root, "learning-notes", "topics", topicId, "courses", `${version}.md`);
    const content = await fs.readFile(source, "utf8");
    const target = path.join(this.root, "zhixing", "topics", topicId, "PLAN.md");
    await fs.mkdir(path.dirname(target), { recursive: true });
    try {
      const previous = await fs.readFile(target, "utf8");
      const backup = path.join(this.root, "learning-notes", "topics", topicId, "plans", `before-${version}.md`);
      await fs.mkdir(path.dirname(backup), { recursive: true });
      await fs.writeFile(backup, previous, "utf8");
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    await fs.writeFile(target, content, "utf8");
  }
}

function coursePlan(topicId: TopicId, title: string, profile: LearningProfile): string {
  const days = profile.totalDays;
  const entries = Array.from({ length: days }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    const phase = courseDayTitle(index, days);
    return `  - id: D${day}\n    title: ${phase}\n    estimatedMinutes: ${profile.dailyMinutes}\n    requiredEvidence: [implementation, test-output, failure-case, reflection]\n    optional: false`;
  }).join("\n");
  return `---\ntopicId: ${topicId}\ntitle: ${title}\nversion: 1\nprerequisites: []\ndays:\n${entries}\n---\n\n# ${title} 定制课程\n\n> 目标：${profile.goal}\n> 当前水平：${profile.level}\n> 每日预算：${profile.dailyMinutes} 分钟\n\n课程由本地画像生成；每个 Day 仍需通过证据 Review 才能完成。\n`;
}

function courseDayTitle(index: number, totalDays: number): string {
  if (index === 0) return "明确目标、资料与起点";
  if (index === totalDays - 1) return "综合复盘、成果整理与下一阶段规划";
  const ratio = index / totalDays;
  if (ratio < 0.25) return "基础概念、术语与先修知识建模";
  if (ratio < 0.5) return "核心原理、方法与受控推导练习";
  if (ratio < 0.8) return "最小实现、调试与失败案例分析";
  return "综合应用、项目证据与面试表达";
}
