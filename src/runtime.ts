import type { TopicId } from "./contracts.js";
import { LearningNotebook } from "./notebook.js";
import { PathPolicy } from "./paths.js";
import { TopicPlanLoader } from "./plan-loader.js";
import { PlanStore } from "./plan-store.js";
import { reviewEvidence, type EvidenceInput } from "./reviewer.js";
import { SessionStore } from "./session-store.js";
import { TopicRegistry } from "./topics.js";

/** Deterministic learning workflow that remains usable without a model provider. */
export class LearningRuntime {
  private readonly notebook: LearningNotebook;
  private readonly plans: PlanStore;
  private readonly planLoader: TopicPlanLoader;
  private readonly sessions: SessionStore;

  constructor(private readonly registry: TopicRegistry, paths: PathPolicy) {
    this.notebook = new LearningNotebook(paths);
    this.plans = new PlanStore(paths);
    this.planLoader = new TopicPlanLoader(paths.root);
    this.sessions = new SessionStore(paths);
  }

  async handle(input: string, activeTopic: TopicId = "agent-development"): Promise<string> {
    const command = input.trim();
    if (command === "主题列表") return this.registry.list().map((topic) => `${topic.topicId}\t${topic.title}`).join("\n");
    const topicMatch = /^学习\s+(.+)$/.exec(command);
    if (topicMatch) {
      const candidate = topicMatch[1]?.trim();
      const topic = this.registry.list().find((item) => item.topicId === candidate || item.title.includes(candidate ?? ""));
      return topic ? `当前主题：${topic.topicId}（${topic.title}）` : "未找到主题；请使用“主题列表”查看可用主题。";
    }
    const dayMatch = /^开始第\s*(\d+)\s*天$/.exec(command);
    if (dayMatch) return this.startDay(activeTopic, `D${dayMatch[1]?.padStart(2, "0")}`);
    if (command === "进度") return this.progress(activeTopic);
    if (command === "全部进度") return this.allProgress();
    if (command === "继续") return this.continueDay(activeTopic);
    if (command === "开始任务") return this.beginTask(activeTopic);
    if (command === "下一步") return this.continueDay(activeTopic);
    const sourceDay = /^读源码\s+(D\d{2})$/.exec(command)?.[1];
    if (sourceDay) return this.sourceGuide(activeTopic, sourceDay);
    return "支持：主题列表、学习 <主题>、开始第 N 天、开始任务、下一步、进度、继续。";
  }

  async proposePlan(topicId: TopicId, dailyMinutes: number): Promise<string> {
    const version = await this.plans.propose(topicId, dailyMinutes, await this.notebook.list(topicId));
    return `已生成计划草案：${version}\n请检查后使用“启用计划 ${version}”确认。`;
  }

  async activatePlan(topicId: TopicId, version: string): Promise<string> {
    await this.plans.activate(topicId, version);
    return `已启用计划：${version}`;
  }

  async sourceGuide(topicId: TopicId, dayId: string): Promise<string> {
    if (await this.notebook.state(topicId, dayId) !== "完成") return `不能读源码：请先完成 ${dayId} 的实验与 Review。`;
    return `源码对照已解锁：围绕 ${dayId} 的输入/输出契约、失败处理和测试证据阅读对应实现。`;
  }

  async allProgress(): Promise<string> {
    const summaries = await Promise.all(this.registry.list().map(async (topic) => {
      const days = await this.notebook.list(topic.topicId);
      const completed = days.filter((day) => day.state === "完成").length;
      const inProgress = days.filter((day) => day.state === "进行中").length;
      return `${topic.topicId}：完成 ${completed}，进行中 ${inProgress}`;
    }));
    return summaries.join("\n");
  }

  async createReviewPlan(topicId: TopicId): Promise<string> {
    await this.plans.reviewPlan(topicId, await this.notebook.list(topicId));
    return "已生成当前主题复习计划。";
  }

  /** Internal trusted gate. Public interfaces derive these checks from LearningApplication artifacts. */
  async reviewDay(topicId: TopicId, dayId: string, evidence: EvidenceInput, provenance?: string): Promise<string> {
    const state = await this.notebook.state(topicId, dayId);
    if (state === "未开始") return `请先开始 ${dayId}。`;
    const required = (await this.planLoader.day(this.registry.get(topicId), dayId))?.requiredEvidence ?? await this.planLoader.requiredEvidence(this.registry.get(topicId));
    const verdict = reviewEvidence(evidence, required);
    await this.notebook.review(topicId, dayId, evidence, verdict, provenance);
    return `Review：${verdict.outcome}（${verdict.score}/8）\n${verdict.nextAction}`;
  }

  private async startDay(topicId: TopicId, dayId: string): Promise<string> {
    const topic = this.registry.get(topicId);
    if (!/^D[0-9]{2}$/.test(dayId) || Number(dayId.slice(1)) < 1) throw new Error("invalid_day");
    const course = await this.planLoader.load(topic);
    const planDay = await this.planLoader.day(topic, dayId);
    if (course && !planDay) throw new Error("invalid_day");
    for (const prerequisite of topic.prerequisites) {
      for (const requiredDay of prerequisite.requiredDays) {
        if (await this.notebook.state(prerequisite.topicId, requiredDay) !== "完成") {
          return `不能开始 ${dayId}：请先完成 ${prerequisite.topicId}/${requiredDay} 并通过 Review。`;
        }
      }
    }
    const number = Number(dayId.slice(1));
    for (let index = 1; index < number; index += 1) {
      const prerequisite = `D${String(index).padStart(2, "0")}`;
      if (await this.notebook.state(topicId, prerequisite) !== "完成") return `不能开始 ${dayId}：请先完成 ${prerequisite} 并通过 Review。`;
    }
    const result = await this.notebook.startDay(topicId, dayId);
    await this.sessions.save(topicId, "current", { dayId, updatedAt: new Date().toISOString() });
    const evidence = planDay?.requiredEvidence.map((item) => ({ implementation: "实现", testOutput: "测试输出", failureCase: "失败案例", reflection: "复盘" })[item]).join("、") ?? "实现、测试输出、失败案例、复盘";
    const schedule = planDay ? (planDay.estimatedMinutes === 240 ? "4 小时安排" : `${planDay.estimatedMinutes} 分钟安排`) : "4 小时安排";
    return result.created ? `今日目标\n${topicId}/${dayId}${planDay ? `：${planDay.title}` : ""}\n\n${schedule}\n完成实验并提交证据。${planDay?.optional ? "（可选）" : ""}\n\n当日学习卡\n讲解：围绕“${planDay?.title ?? "当前主题核心概念"}”建立可验证理解；先阅读资料，再做一个最小实验。\n任务 1：查询或阅读一份当前主题资料，写下 3 个关键概念。\n任务 2：完成一个最小实现/复现实验，并保留测试输出。\n失败案例：主动记录一个错误输入、失败配置或未达预期结果及原因。\n复盘问题：今天哪个假设被证据支持或推翻？\n\n完成证据\n${evidence}\n\n下一步\n输入“开始任务”领取第一步；提交实际证据后输入“检查 ${dayId}”。` : `已恢复 ${topicId}/${dayId}，输入“开始任务”查看当日学习卡并提交缺失证据。`;
  }

  private async progress(topicId: TopicId): Promise<string> {
    const days = await this.notebook.list(topicId);
    return days.length ? `${topicId}\n${days.map((day) => `${day.dayId}：${day.state}`).join("\n")}` : `${topicId}：尚未开始`;
  }

  private async continueDay(topicId: TopicId): Promise<string> {
    const snapshot = await this.sessions.load<{ dayId: string }>(topicId, "current");
    const next = (await this.notebook.list(topicId)).find((day) => day.dayId === snapshot?.dayId && day.state === "进行中") ?? (await this.notebook.list(topicId)).find((day) => day.state === "进行中");
    return next ? `下一步：继续 ${next.dayId}。输入“开始任务”查看学习卡；完成后提交实现、测试输出、失败案例和复盘。` : "当前主题没有进行中的学习日；请开始下一个 Day。";
  }

  private async beginTask(topicId: TopicId): Promise<string> {
    const snapshot = await this.sessions.load<{ dayId: string }>(topicId, "current");
    if (!snapshot || await this.notebook.state(topicId, snapshot.dayId) !== "进行中") return "当前没有进行中的学习日；请先使用“开始第 N 天”。";
    const day = await this.planLoader.day(this.registry.get(topicId), snapshot.dayId);
    return `开始 ${snapshot.dayId}${day ? `：${day.title}` : ""}\n1. 阅读/查询当前主题资料，整理 3 个关键概念。\n2. 做一个最小实验并保留测试输出。\n3. 记录一个失败案例和原因。\n4. 提交实现、测试报告、失败案例和复盘后使用“检查 ${snapshot.dayId}”。`;
  }
}
