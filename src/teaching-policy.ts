import type { LearningObservations } from "./learning-observations.js";
import { CONCEPT_VERSION, matchingConcepts, reviewRequest, topicConcepts } from "./learning-concepts.js";

/** Suggests a teaching action from actual answers. It never writes mastery or course completion. */
export class TeachingPolicy {
  constructor(private readonly observations: LearningObservations) {}
  decide(topic: string, query: string) {
    const records = this.observations.list(topic).filter(record => !record.withdrawn);
    const matching = matchingConcepts(topic, query);
    const selected = matching.length ? matching : reviewRequest(query) ? topicConcepts(topic).filter(concept => records.some(record => record.concepts?.some(item => item.conceptId === concept.id))).slice(0, 6) : [];
    const concepts = selected.map(concept => {
      const sources = records.flatMap(record => (record.concepts ?? []).filter(item => item.conceptId === concept.id && item.catalogVersion === CONCEPT_VERSION).map(item => ({ id: record.id, revision: record.revision, questionIndex: item.questionIndex, correct: item.correct, assistance: record.assistance, correction: record.annotation, explanation: item.explanation, submittedAt: record.submittedAt }))).slice(0, 3);
      const latest = sources[0];
      const state = !latest ? "unobserved" : !latest.correct ? "practice_needed" : latest.correction.trim() ? "needs_review" : latest.assistance === "independent" ? "independent_evidence" : latest.assistance === "hint" || latest.assistance === "solution" ? "assisted_evidence" : "help_unknown";
      return { id: concept.id, title: concept.title, state, sources };
    });
    const hintRequested = /只给提示|不要(?:直接)?给?(?:出)?答案|先别给答案|hint only|do not (?:give|show).*answer/i.test(query);
    const directRequested = !hintRequested && /直接(?:给|回答)|给(?:出)?(?:完整)?答案|参考答案|完整讲解|逐步推导|just (?:answer|give)|show.*solution|direct answer/i.test(query);
    const action = hintRequested ? "hint" : directRequested ? "direct_answer" : concepts.some(concept => concept.state === "practice_needed") ? "contrast_example" : concepts.some(concept => ["assisted_evidence", "help_unknown", "needs_review"].includes(concept.state)) ? "guided_practice" : concepts.some(concept => concept.state === "independent_evidence") ? "transfer_practice" : "explain";
    const guidance = { hint: "按要求只给提示。", direct_answer: "先完整回答当前问题，不以测验或确认打断。", contrast_example: "围绕实际错题给正例与反例，解释区别；不把旧错题推断为所有问题都不会。", guided_practice: "先补足解释，再按用户意愿提供逐步练习；帮助方式是用户自报。", transfer_practice: "可提供同知识点新情境，避免重复原题；一次答对不代表整体掌握。", explain: "直接解释当前问题，无需索要画像或虚构学习状态。" }[action];
    return { catalogVersion: CONCEPT_VERSION, action, guidance, concepts, evidenceScope: "仅限实际知识检查；不含未完成效果试验答案，不授予权限，不改变课程状态。", userPriority: "以上是建议。用户的当前问题和格式要求优先；只有明确要求互动教学才逐题等待。" };
  }
}
