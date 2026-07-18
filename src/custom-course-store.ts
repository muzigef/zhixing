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
  const days = Math.min(profile.totalDays, 30);
  const entries = Array.from({ length: days }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    const phase = index === 0 ? "明确目标、资料与起点" : index === days - 1 ? "综合复盘与成果整理" : `围绕目标进行第 ${index + 1} 次学习与练习`;
    return `  - id: D${day}\n    title: ${phase}\n    estimatedMinutes: ${profile.dailyMinutes}\n    requiredEvidence: [implementation, test-output, failure-case, reflection]\n    optional: false`;
  }).join("\n");
  return `---\ntopicId: ${topicId}\ntitle: ${title}\nversion: 1\nprerequisites: []\ndays:\n${entries}\n---\n\n# ${title} 定制课程\n\n> 目标：${profile.goal}\n> 当前水平：${profile.level}\n> 每日预算：${profile.dailyMinutes} 分钟\n\n课程由本地画像生成；每个 Day 仍需通过证据 Review 才能完成。\n`;
}
