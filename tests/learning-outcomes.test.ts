import { afterEach, expect, it } from "vitest";
import { ZhixingDatabase } from "../src/database.js";
import { LearningOutcomeStore, summarizeOutcomes } from "../src/learning-outcomes.js";

const databases: ZhixingDatabase[] = [];
const start = new Date("2026-09-07T00:00:00Z");
function fixture() { const db = new ZhixingDatabase(":memory:"); databases.push(db); return new LearningOutcomeStore(db, () => start); }
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
const answer = { answers: [0, 1, 2], explanation: "我根据实际证据判断结果。", assistance: "independent" as const };
const lesson = { sessionId: "00000000-0000-4000-8000-000000000001", conditions: [{ provider: "pi-codex", model: "fixture-model", reasoning: "balanced", style: "adaptive" }], completedTurns: 1, failedTurns: 0, durationMs: 1000 };

it("keeps answer keys and future forms out of learner views and enforces topic/stage boundaries", () => {
  const store = fixture(); const trial = store.start("agent-development", "zhixing");
  expect(trial.stage).toBe("pre"); expect(trial.questions).toHaveLength(3);
  expect(JSON.stringify(trial)).not.toMatch(/"correct"|"feedback"/);
  expect(() => store.submit("rag", trial.id, "pre", answer)).toThrow("cross_topic_denied");
  expect(() => store.submit("agent-development", trial.id, "post", answer)).toThrow("outcome_stage_invalid");
  expect(() => store.start("agent-development", "direct")).toThrow("outcome_active");
  const submitted = store.submit("agent-development", trial.id, "pre", answer);
  expect(submitted.stage).toBe("lesson"); expect(submitted.questions).toEqual([]);
  expect(store.submit("agent-development", trial.id, "pre", answer)).toEqual(submitted);
  expect(() => store.submit("agent-development", trial.id, "pre", { ...answer, assistance: "solution" })).toThrow("outcome_already_submitted");
  expect(() => store.start("custom-topic", "zhixing")).toThrow("outcome_not_available");
});

it("requires a real completed lesson, preserves assisted evidence and rejects early retention checks", () => {
  const store = fixture(); const trial = store.start("agent-development", "direct");
  store.submit("agent-development", trial.id, "pre", answer);
  store.attachSession("agent-development", trial.id, lesson.sessionId);
  expect(() => store.finishLesson("agent-development", trial.id, { ...lesson, completedTurns: 0 })).toThrow("outcome_lesson_incomplete");
  const post = store.finishLesson("agent-development", trial.id, lesson);
  expect(post.questions.map(q => q.title)).not.toEqual(trial.questions.map(q => q.title));
  const waiting = store.submit("agent-development", trial.id, "post", { ...answer, assistance: "hint" });
  expect(waiting.stage).toBe("waiting"); expect(waiting.reviewAt).toBe("2026-09-10T00:00:00.000Z");
  expect(() => store.openRetention("agent-development", trial.id)).toThrow("outcome_review_not_due");
  expect(waiting.results.post?.assistance).toBe("hint");
  expect(waiting.results.post?.explanationReview).toBe("pending_human_review");
});

it("uses a server clock for delayed checks, resumes persisted trials and reports missing data explicitly", () => {
  const db = new ZhixingDatabase(":memory:"); databases.push(db); let clock = start;
  let store = new LearningOutcomeStore(db, () => clock);
  const trial = store.start("rag", "zhixing"); store.submit("rag", trial.id, "pre", answer); store.attachSession("rag", trial.id, lesson.sessionId);
  store.finishLesson("rag", trial.id, lesson); store.submit("rag", trial.id, "post", answer);
  expect(summarizeOutcomes(store.list("rag")).groups[0]).toMatchObject({ independentPairs: 1, retentionPairs: 0, retentionChange: null });
  clock = new Date("2026-09-10T00:00:00Z"); store = new LearningOutcomeStore(db, () => clock);
  const delayed = store.openRetention("rag", trial.id); expect(delayed.stage).toBe("delayed");
  const done = store.submit("rag", trial.id, "delayed", answer);
  expect(done.stage).toBe("complete"); expect(done.feedback).toHaveLength(3);
  expect(summarizeOutcomes(store.list("rag")).groups[0]?.retentionPairs).toBe(1);
  expect(store.start("rag", "direct").repeated).toBe(true);
});

it("excludes demo, unknown/mixed models, assistance and repeats from primary paired summaries", () => {
  const store = fixture(); const trial = store.start("agent-development", "zhixing");
  store.submit("agent-development", trial.id, "pre", answer); store.attachSession("agent-development", trial.id, lesson.sessionId);
  store.finishLesson("agent-development", trial.id, { ...lesson, conditions: [{ ...lesson.conditions[0]!, provider: "demo" }] });
  store.submit("agent-development", trial.id, "post", answer);
  const report = summarizeOutcomes(store.list("agent-development"));
  expect(report.groups).toEqual([]); expect(report.exclusions.demo).toBe(1);
  expect(report.conclusion).toBe("descriptive_only");
});

it("keeps each exclusion explicit and never turns absent retention observations into zero", () => {
  const store = fixture(); const trial = store.start("agent-development", "zhixing");
  store.submit("agent-development", trial.id, "pre", answer); store.attachSession("agent-development", trial.id, lesson.sessionId);
  store.finishLesson("agent-development", trial.id, lesson);
  const post = store.submit("agent-development", trial.id, "post", answer);
  const changed = { ...post, lesson: { ...lesson, conditions: [...lesson.conditions, { ...lesson.conditions[0]!, model: "other-model" }] } };
  const unknown = { ...post, lesson: { ...lesson, conditions: [{ ...lesson.conditions[0]!, model: undefined }] } };
  const assisted = { ...post, results: { ...post.results, pre: { ...post.results.pre!, assistance: "solution" as const } } };
  const report = summarizeOutcomes([post, { ...post, mode: "direct" }, changed, unknown, assisted, { ...post, repeated: true }]);
  expect(report.groups).toHaveLength(2);
  expect(report.groups.every(g => g.independentPairs === 1 && g.retentionChange === null)).toBe(true);
  expect(report.exclusions).toEqual({ changed_conditions: 1, unknown_model: 1, assisted: 1, repeated: 1 });
});

it("grades unknown answers honestly, rejects model-origin payloads and preserves abandoned records", () => {
  const store = fixture(); const trial = store.start("rag", "direct");
  expect(() => store.submit("rag", trial.id, "pre", { ...answer, source: "assistant" })).toThrow();
  expect(() => store.submit("rag", trial.id, "pre", { ...answer, explanation: "   " })).toThrow();
  const result = store.submit("rag", trial.id, "pre", { ...answer, answers: [-1, -1, -1] });
  expect(result.results.pre?.correctCount).toBe(0);
  store.abandon("rag", trial.id);
  expect(store.list("rag")[0]?.results.pre).toEqual(result.results.pre);
  expect(() => store.submit("rag", trial.id, "post", answer)).toThrow("outcome_stage_invalid");
  expect(store.start("rag", "zhixing").repeated).toBe(true);
});

it("keeps completed pre/post pairs when a learner ends before retention, avoiding completer-only bias", () => {
  const store = fixture(); const trial = store.start("agent-development", "direct");
  store.submit("agent-development", trial.id, "pre", answer); store.attachSession("agent-development", trial.id, lesson.sessionId);
  store.finishLesson("agent-development", trial.id, lesson); store.submit("agent-development", trial.id, "post", answer);
  store.abandon("agent-development", trial.id);
  const report = summarizeOutcomes(store.list("agent-development"));
  expect(report.incomplete).toBe(1);
  expect(report.groups[0]).toMatchObject({ independentPairs: 1, retentionPairs: 0, retentionChange: null });
});
