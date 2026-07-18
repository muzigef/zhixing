import fs from "node:fs/promises";
import path from "node:path";
import type { TopicId } from "./contracts.js";
import { PathPolicy } from "./paths.js";

export interface PlanDay { readonly dayId: string; readonly state: "未开始" | "进行中" | "完成"; readonly score?: number; }

/** Creates versioned plan proposals and requires a separate activation command. */
export class PlanStore {
  constructor(private readonly paths: PathPolicy, private readonly now: () => Date = () => new Date()) {}

  async propose(topicId: TopicId, dailyMinutes: number, days: readonly PlanDay[]): Promise<string> {
    if (!Number.isInteger(dailyMinutes) || dailyMinutes < 15 || dailyMinutes > 480) throw new Error("invalid_daily_minutes: 请输入 15–480 的整数分钟。");
    const version = `plan-${this.now().toISOString().replace(/[:.]/g, "-")}`;
    const file = this.paths.resolveTopicPath(topicId, "notes", "plans", `${version}.md`);
    await fs.mkdir(path.dirname(file), { recursive: true });
    const unfinished = days.filter((day) => day.state !== "完成");
    const content = `# 学习计划草案\n\n> 版本：${version}\n> 主题：${topicId}\n> 每日预算：${dailyMinutes} 分钟\n> 状态：待确认\n\n## 后续安排\n${unfinished.length ? unfinished.map((day, index) => `${index + 1}. ${day.dayId}：${day.state === "进行中" ? "补齐证据并完成 Review" : "开始学习与实验"}（${dailyMinutes} 分钟）`).join("\n") : "当前主题已完成；下一次安排复习。"}\n\n## 启用方式\n执行：启用计划 ${version}\n`;
    await atomicWrite(file, content);
    return version;
  }

  async activate(topicId: TopicId, version: string): Promise<void> {
    if (!/^plan-[\dTZ-]+$/.test(version)) throw new Error("invalid_plan_version");
    const source = this.paths.resolveTopicPath(topicId, "notes", "plans", `${version}.md`);
    const content = await fs.readFile(source, "utf8");
    await atomicWrite(this.paths.resolveTopicPath(topicId, "notes", "ACTIVE_PLAN.md"), content.replace("状态：待确认", "状态：已启用"));
  }

  async reviewPlan(topicId: TopicId, days: readonly PlanDay[]): Promise<string> {
    const completed = days.filter((day) => day.state === "完成").sort((left, right) => (left.score ?? 8) - (right.score ?? 8));
    const inProgress = days.filter((day) => day.state === "进行中");
    const tasks = [
      ...inProgress.map((day) => `- 优先：${day.dayId} 仍在进行中，先补齐证据。`),
      ...completed.map((day) => `- 复习：${day.dayId}（评分 ${day.score ?? 8}/8），回忆核心概念并重做一个失败案例；下次间隔：${(day.score ?? 8) < 8 ? "1 天" : "3 天"}。`),
    ];
    const content = `# 复习计划\n\n> 主题：${topicId}\n> 生成时间：${this.now().toISOString()}\n\n${tasks.length ? tasks.join("\n") : "- 尚无已完成学习日，先开始 Day 1。"}\n`;
    await atomicWrite(this.paths.resolveTopicPath(topicId, "notes", "REVIEW_PLAN.md"), content);
    return content;
  }
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, content, "utf8");
  await fs.rename(temporary, file);
}
