import type { TopicId } from "./contracts.js";
import { ZhixingDatabase } from "./database.js";
import { DocumentLibrary } from "./library.js";
import { LearningProfileStore } from "./learning-profile.js";
import type { TeachingSession } from "./teaching-session-store.js";

/** Builds a bounded, topic-scoped prompt context instead of concatenating all history. */
export class LearningContextBuilder {
  constructor(private readonly profiles: LearningProfileStore, private readonly database: ZhixingDatabase, private readonly library: DocumentLibrary) {}

  async build(topicId: TopicId, query: string, teaching?: TeachingSession): Promise<string> {
    const [profile, documents] = await Promise.all([this.profiles.load(topicId), Promise.resolve(this.library.list(topicId))]);
    const matchingMemories = this.database.searchMemories(topicId, query);
    const memories = (matchingMemories.length ? matchingMemories : this.database.searchMemories(topicId, "")).slice(0, 3);
    return [
      `当前主题：${topicId}`,
      profile ? `学习画像：目标=${profile.goal}；水平=${profile.level}；每天=${profile.dailyMinutes} 分钟；周期=${profile.totalDays} 天` : "学习画像：未设置",
      teaching ? `教学检查点：${teaching.dayId ?? "当前任务"}；阶段=${teaching.stage}；练习轮次=${teaching.quizRound}${teaching.currentExercise ? `；当前练习=${teaching.currentExercise.slice(0, 1_500)}` : ""}` : "教学检查点：无",
      `相关记忆：${memories.length ? memories.map((item) => item.content.slice(0, 1_500)).join("；") : "无"}`,
      `资料摘要：${documents.slice(0, 8).map((item) => item.name).join("、") || "无"}`,
    ].join("\n");
  }
}
