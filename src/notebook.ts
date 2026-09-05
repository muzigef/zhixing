import fs from "node:fs/promises";
import path from "node:path";
import type { TopicId } from "./contracts.js";
import { PathPolicy } from "./paths.js";
import type { EvidenceInput, ReviewVerdict } from "./reviewer.js";

/** Stores learning-day evidence and progress through atomic same-directory replacements. */
export class LearningNotebook {
  constructor(private readonly paths: PathPolicy) {}

  async startDay(topicId: TopicId, dayId: string): Promise<{ created: boolean }> {
    const file = this.dayFile(topicId, dayId);
    await this.paths.assertNoSymlink(topicId, "notes");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await this.paths.assertNoSymlink(topicId, "notes");
    try { await fs.access(file); return { created: false }; } catch {
      await atomicWrite(file, `# ${dayId}\n\n> 状态：进行中\n> 主题：${topicId}\n\n## 实验与证据\n\n## Review\n\n`);
      await this.updateProgress(topicId, dayId, "进行中", "—");
      return { created: true };
    }
  }

  async state(topicId: TopicId, dayId: string): Promise<"未开始" | "进行中" | "完成"> {
    try {
      const content = await fs.readFile(this.dayFile(topicId, dayId), "utf8");
      if (content.includes("> 状态：完成")) return "完成";
      return "进行中";
    } catch { return "未开始"; }
  }

  async review(topicId: TopicId, dayId: string, evidence: EvidenceInput, verdict: ReviewVerdict, provenance?: string): Promise<void> {
    const file = this.dayFile(topicId, dayId);
    const current = await fs.readFile(file, "utf8");
    const nextState = verdict.outcome === "advance" ? "完成" : "进行中";
    const review = `### ${new Date().toISOString()}\n- verdict：${verdict.outcome}\n- score：${verdict.score}/8\n- 缺失：${verdict.missing.length ? verdict.missing.join("、") : "无"}\n- 下一步：${verdict.nextAction}\n- 证据：实现=${evidence.implementation}，测试=${evidence.testOutput}，失败案例=${evidence.failureCase}，复盘=${evidence.reflection}\n\n`;
    const withState = current.replace(/> 状态：(进行中|完成)/, `> 状态：${nextState}`);
    await atomicWrite(file, `${withState.replace("## Review\n\n", `## Review\n\n${review}${provenance ? `证据来源与校验：${provenance}\n\n` : ""}`)}`);
    await this.updateProgress(topicId, dayId, nextState, `${verdict.score}/8`);
  }

  async list(topicId: TopicId): Promise<Array<{ dayId: string; state: "未开始" | "进行中" | "完成" }>> {
    const directory = this.paths.resolveTopicPath(topicId, "notes", "daily");
    try {
      const files = (await fs.readdir(directory)).filter((file) => /^D\d{2}\.md$/.test(file)).sort();
      return Promise.all(files.map(async (file) => {
        const dayId = file.slice(0, -3);
        const content = await fs.readFile(path.join(directory, file), "utf8");
        const scores = [...content.matchAll(/- score：(\d+)\/8/g)].map((match) => Number(match[1]));
        return { dayId, state: await this.state(topicId, dayId), score: scores.at(-1) };
      }));
    } catch { return []; }
  }

  private dayFile(topicId: TopicId, dayId: string): string { return this.paths.resolveTopicPath(topicId, "notes", "daily", `${dayId}.md`); }

  private async updateProgress(topicId: TopicId, dayId: string, state: "进行中" | "完成", score: string): Promise<void> {
    const file = this.paths.resolveTopicPath(topicId, "notes", "PROGRESS.md");
    await fs.mkdir(path.dirname(file), { recursive: true });
    let current: string;
    try { current = await fs.readFile(file, "utf8"); } catch { current = "# 学习进度\n\n| Day | 状态 | 评分 |\n| --- | --- | --- |\n"; }
    const row = `| ${dayId} | ${state} | ${score} |`;
    const pattern = new RegExp(`^\\| ${dayId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\|.*$`, "m");
    await atomicWrite(file, pattern.test(current) ? current.replace(pattern, row) : `${current}${row}\n`);
  }
}

async function atomicWrite(file: string, content: string): Promise<void> {
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, content, "utf8");
  await fs.rename(temporary, file);
}
