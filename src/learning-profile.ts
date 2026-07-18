import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { TopicId } from "./contracts.js";
import { PathPolicy } from "./paths.js";

export const learningProfileSchema = z.object({
  goal: z.string().trim().min(2).max(240),
  level: z.string().trim().min(1).max(80),
  dailyMinutes: z.number().int().min(15).max(480),
  totalDays: z.number().int().min(1).max(180),
});
export type LearningProfile = z.infer<typeof learningProfileSchema>;

/** Local, user-controlled learning preferences; never sent to a provider without CLI consent. */
export class LearningProfileStore {
  constructor(private readonly paths: PathPolicy, private readonly now: () => Date = () => new Date()) {}

  async save(topicId: TopicId, input: LearningProfile): Promise<void> {
    const profile = learningProfileSchema.parse(input);
    await atomicWrite(this.profileFile(topicId), `${JSON.stringify(profile, null, 2)}\n`);
  }

  async load(topicId: TopicId): Promise<LearningProfile | undefined> {
    try { return learningProfileSchema.parse(JSON.parse(await fs.readFile(this.profileFile(topicId), "utf8"))); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  }

  async proposePlan(topicId: TopicId): Promise<string> {
    const profile = await this.load(topicId);
    if (!profile) throw new Error("learning_profile_required: 请先设置学习画像。");
    const version = `personal-plan-${this.now().toISOString().replace(/[:.]/g, "-")}`;
    const sessions = Math.ceil(profile.totalDays / 7);
    const content = `# 个性化学习计划草案\n\n> 版本：${version}\n> 主题：${topicId}\n> 目标：${profile.goal}\n> 当前水平：${profile.level}\n> 每日预算：${profile.dailyMinutes} 分钟\n> 总周期：${profile.totalDays} 天\n> 状态：待确认\n\n## 节奏\n${Array.from({ length: sessions }, (_, index) => `${index + 1}. 第 ${index * 7 + 1}–${Math.min((index + 1) * 7, profile.totalDays)} 天：学习、练习、复盘；每次 ${profile.dailyMinutes} 分钟。`).join("\n")}\n\n## 完成标准\n- 每个既有 Day 仍须通过实现、测试输出、失败案例和复盘的证据 Review。\n- 模型建议只作为建议，不会自动将学习日标记为完成。\n\n## 启用方式\n执行：启用个性化计划 ${version}\n`;
    await atomicWrite(this.paths.resolveTopicPath(topicId, "notes", "plans", `${version}.md`), content);
    return version;
  }

  async activatePlan(topicId: TopicId, version: string): Promise<void> {
    if (!/^personal-plan-[\dTZ-]+$/.test(version)) throw new Error("invalid_plan_version");
    const content = await fs.readFile(this.paths.resolveTopicPath(topicId, "notes", "plans", `${version}.md`), "utf8");
    await atomicWrite(this.paths.resolveTopicPath(topicId, "notes", "ACTIVE_PERSONAL_PLAN.md"), content.replace("状态：待确认", "状态：已启用"));
  }

  private profileFile(topicId: TopicId): string { return this.paths.resolveTopicPath(topicId, "notes", "LEARNING_PROFILE.json"); }
}

async function atomicWrite(file: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, content, "utf8");
  await fs.rename(temporary, file);
}
