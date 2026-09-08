import type { TopicId } from "./contracts.js";
import { ZhixingDatabase } from "./database.js";
import { DocumentLibrary } from "./library.js";
import { LearningProfileStore } from "./learning-profile.js";
import { TeachingSessionStore, type TeachingSession } from "./teaching-session-store.js";
import { LearningObservations } from "./learning-observations.js";
import { TeachingPolicy } from "./teaching-policy.js";
import { relevantExcerpt } from "./conversation-context.js";

/** Builds a bounded, topic-scoped prompt context instead of concatenating all history. */
export class LearningContextBuilder {
  constructor(private readonly profiles: LearningProfileStore, private readonly database: ZhixingDatabase, private readonly library: DocumentLibrary, private readonly teaching?: TeachingSessionStore) {}

  /** Fresh on every turn: withdrawal and profile edits never depend on a cached prompt. */
  async snapshot(topicId: TopicId, query: string, teaching?: TeachingSession | null) {
    const profile = await this.profiles.load(topicId);
    const checkpoint = teaching === undefined ? await this.teaching?.load(topicId) : teaching;
    const matching = this.database.searchMemories(topicId, query);
    const memories = (matching.length ? matching : this.database.searchMemories(topicId, "")).slice(0, 3)
      .map(item => ({ id: item.id, content: relevantExcerpt(item.content, 1500, query), sourceRef: item.sourceRef, selection: matching.length ? "query_relevant" : "recent_fallback" }));
    return {
      ...(profile ? { profile } : {}), memories,
      ...(checkpoint ? { teaching: { dayId: checkpoint.dayId, stage: checkpoint.stage, quizRound: checkpoint.quizRound,
        currentExercise: checkpoint.currentExercise?.slice(0, 8000), learnerAttempts: checkpoint.learnerAttempts } } : {}),
    };
  }

  async build(topicId: TopicId, query: string, teaching?: TeachingSession | null): Promise<string> {
    const { profile, memories } = await this.snapshot(topicId, query, teaching);
    const documents = this.library.list(topicId);
    return [
      `教学建议（服从本轮要求）：${JSON.stringify(new TeachingPolicy(new LearningObservations(this.database)).decide(topicId, query))}`,
      ...new LearningObservations(this.database).context(topicId, query).map(item => `实际作答记录（不是掌握结论）：${JSON.stringify(item)}`),
      `当前主题：${topicId}`,
      profile ? `学习画像：目标=${profile.goal}；水平=${profile.level}；每天=${profile.dailyMinutes} 分钟；周期=${profile.totalDays} 天` : "学习画像：未设置",
      teaching ? `教学检查点：${teaching.dayId ?? "当前任务"}；阶段=${teaching.stage}；练习轮次=${teaching.quizRound}${teaching.currentExercise ? `；当前练习=${teaching.currentExercise.slice(0, 1_500)}` : ""}` : "教学检查点：无",
      `相关记忆：${memories.length ? memories.map((item) => item.content.slice(0, 1_500)).join("；") : "无"}`,
      `资料摘要：${documents.slice(0, 8).map((item) => item.name).join("、") || "无"}`,
    ].join("\n");
  }
}
