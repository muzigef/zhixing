import { createHash, randomInt, randomUUID } from "node:crypto";
import { explanationReviewInputSchema } from "./outcome-contracts.js";
import { outcomeProtocolSchema, type OutcomeProtocol } from "./outcome-contracts.js";
import { buildProvenanceSchema, type BuildProvenance } from "./build-provenance.js";
import { z } from "zod/v4";
import type { ZhixingDatabase } from "./database.js";
import { topicIdSchema } from "./contracts.js";
import { outcomeBank } from "./outcome-bank.js";
import { lessonEvidenceSchema, outcomeViewSchema, outcomeModeSchema, outcomePhaseSchema, outcomeSubmissionSchema, type LessonEvidence, type OutcomeMode, type OutcomePhase, type OutcomeResult, type OutcomeSummary, type OutcomeView } from "./outcome-contracts.js";

interface StoredTrial extends Omit<OutcomeView, "title" | "questions" | "feedback"> { forms: number[]; openedAt: string; }
const phases: OutcomePhase[] = ["pre", "post", "delayed"];
const storedTrialSchema = outcomeViewSchema.omit({ title: true, questions: true, feedback: true }).extend({
  forms: z.array(z.number().int().min(0).max(2)).length(3).refine(forms => new Set(forms).size === 3),
  openedAt: z.string().datetime(),
});

/** Local learner submissions only. This store is intentionally absent from model tools/context. */
export class LearningOutcomeStore {
  constructor(private readonly database: ZhixingDatabase, private readonly now = () => new Date()) {
    database.db.exec("CREATE TABLE IF NOT EXISTS learning_outcomes(id TEXT PRIMARY KEY, topic TEXT NOT NULL, value TEXT NOT NULL)");
  }
  private read(topic: string, id: string): StoredTrial {
    topicIdSchema.parse(topic); z.string().uuid().parse(id);
    const row = this.database.db.prepare("SELECT topic,value FROM learning_outcomes WHERE id=?").get(id) as { topic: string; value: string } | undefined;
    if (!row) throw new Error("outcome_not_found");
    if (row.topic !== topic) throw new Error("cross_topic_denied");
    const value = JSON.parse(row.value) as { bankVersion?: number };
    if (value.bankVersion !== 1) throw new Error("storage_version_unsupported");
    const trial = storedTrialSchema.parse(value);
    if (trial.topicId !== topic || trial.id !== id) throw new Error("cross_topic_denied");
    return trial;
  }
  private save(trial: StoredTrial): OutcomeView {
    this.database.db.prepare("INSERT INTO learning_outcomes(id,topic,value) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(trial.id, trial.topicId, JSON.stringify(trial));
    return this.view(trial);
  }
  private view(trial: StoredTrial): OutcomeView {
    const unit = outcomeBank[trial.topicId]!;
    const { forms } = trial;
    const phase = phases.indexOf(trial.stage as OutcomePhase);
    return { id: trial.id, topicId: trial.topicId, mode: trial.mode, bankVersion: trial.bankVersion,
      protocol: trial.protocol ?? "prompt_only", provenance: trial.provenance,
      stage: trial.stage, repeated: trial.repeated, createdAt: trial.createdAt, reviewAt: trial.reviewAt,
      sessionId: trial.sessionId, results: trial.results, lesson: trial.lesson, title: unit.title,
      questions: phase < 0 ? [] : unit.forms[forms[phase]!]!.map(({ title, choices }) => ({ title, choices })),
      ...(trial.stage === "complete" ? { feedback: unit.forms[forms[2]!]!.map(q => q.feedback) } : {}),
    };
  }
  get(topic: string, id: string) { return this.view(this.read(topic, id)); }
  list(topic: string): OutcomeView[] {
    topicIdSchema.parse(topic);
    const rows = this.database.db.prepare("SELECT id FROM learning_outcomes WHERE topic=? ORDER BY rowid DESC").all(topic) as { id: string }[];
    return rows.map(row => this.get(topic, row.id));
  }
  start(topic: string, rawMode: OutcomeMode, rawProtocol: OutcomeProtocol = "prompt_only"): OutcomeView {
    topicIdSchema.parse(topic); const mode = outcomeModeSchema.parse(rawMode);
    const protocol = outcomeProtocolSchema.parse(rawProtocol);
    if (!outcomeBank[topic]) throw new Error("outcome_not_available");
    return this.database.db.transaction(() => {
      const previous = this.list(topic);
      if (previous.some(t => !["complete", "abandoned"].includes(t.stage))) throw new Error("outcome_active");
      if (previous.length >= 50) throw new Error("outcome_limit");
      const forms = [0, 1, 2];
      for (let i = 2; i > 0; i--) { const j = randomInt(i + 1); [forms[i], forms[j]] = [forms[j]!, forms[i]!]; }
      const timestamp = this.now().toISOString();
      return this.save({ id: randomUUID(), topicId: topic, mode, protocol, bankVersion: 1, stage: "pre", repeated: previous.length > 0, createdAt: timestamp, openedAt: timestamp, forms, results: {} });
    })();
  }
  submit(topic: string, id: string, rawPhase: OutcomePhase, raw: unknown): OutcomeView {
    const phase = outcomePhaseSchema.parse(rawPhase); const submission = outcomeSubmissionSchema.parse(raw);
    return this.database.db.transaction(() => {
      const trial = this.read(topic, id); const previous = trial.results[phase];
      if (previous) {
        if (JSON.stringify(previous.answers) !== JSON.stringify(submission.answers) || previous.explanation !== submission.explanation || previous.assistance !== submission.assistance) throw new Error("outcome_already_submitted");
        return this.view(trial);
      }
      if (trial.stage !== phase) throw new Error("outcome_stage_invalid");
      const now = this.now();
      if (phase === "delayed" && (!trial.reviewAt || now.getTime() < Date.parse(trial.reviewAt))) throw new Error("outcome_review_not_due");
      const questions = outcomeBank[topic]!.forms[trial.forms[phases.indexOf(phase)]!]!;
      trial.results[phase] = { ...submission, formId: trial.forms[phases.indexOf(phase)]!, correctCount: questions.filter((q, i) => q.correct === submission.answers[i]).length, total: questions.length, submittedAt: now.toISOString(), elapsedMs: Math.max(0, now.getTime() - Date.parse(trial.openedAt)), explanationReview: "pending_human_review" };
      trial.stage = phase === "pre" ? "lesson" : phase === "post" ? "waiting" : "complete";
      if (phase === "post") trial.reviewAt = new Date(now.getTime() + 3 * 86400000).toISOString();
      return this.save(trial);
    })();
  }
  attachSession(topic: string, id: string, sessionId: string): OutcomeView {
    z.string().uuid().parse(sessionId); const trial = this.read(topic, id);
    if (trial.stage !== "lesson") throw new Error("outcome_stage_invalid");
    if (trial.sessionId && trial.sessionId !== sessionId) throw new Error("outcome_session_mismatch");
    trial.sessionId = sessionId; return this.save(trial);
  }
  bindProvenance(topic: string, id: string, provenance: BuildProvenance): void {
    const trial = this.read(topic, id);
    if (trial.stage !== "lesson") throw new Error("outcome_stage_invalid");
    if (!trial.provenance) { trial.provenance = buildProvenanceSchema.parse(provenance); this.save(trial); }
  }
  finishLesson(topic: string, id: string, raw: LessonEvidence): OutcomeView {
    const evidence = lessonEvidenceSchema.parse(raw); const trial = this.read(topic, id);
    if (trial.stage === "post" && trial.sessionId === evidence.sessionId) return this.view(trial);
    if (trial.stage !== "lesson") throw new Error("outcome_stage_invalid");
    if (evidence.sessionId !== trial.sessionId) throw new Error("outcome_session_mismatch");
    if (!evidence.completedTurns) throw new Error("outcome_lesson_incomplete");
    trial.lesson = evidence; trial.stage = "post"; trial.openedAt = this.now().toISOString();
    return this.save(trial);
  }
  openRetention(topic: string, id: string): OutcomeView {
    const trial = this.read(topic, id);
    if (trial.stage === "delayed") return this.view(trial);
    if (trial.stage !== "waiting") throw new Error("outcome_stage_invalid");
    if (!trial.reviewAt || this.now().getTime() < Date.parse(trial.reviewAt)) throw new Error("outcome_review_not_due");
    trial.stage = "delayed"; trial.openedAt = this.now().toISOString(); return this.save(trial);
  }
  abandon(topic: string, id: string): OutcomeView {
    const trial = this.read(topic, id);
    if (trial.stage !== "complete") trial.stage = "abandoned";
    return this.save(trial);
  }
  reviewExplanation(topic: string, id: string, rawPhase: OutcomePhase, raw: unknown): OutcomeView {
    const phase = outcomePhaseSchema.parse(rawPhase); const input = explanationReviewInputSchema.parse(raw);
    return this.database.db.transaction(() => {
      const trial = this.read(topic, id);
      if (!["complete", "abandoned"].includes(trial.stage)) throw new Error("outcome_review_not_ready");
      const result = trial.results[phase];
      if (!result || result.explanation !== input.expectedExplanation || (result.reviews?.length ?? 0) !== input.expectedRevision || input.expectedRevision >= 100) throw new Error("outcome_review_conflict");
      const sourceHash = createHash("sha256").update(JSON.stringify([topic, id, phase, result.answers, result.explanation, result.assistance, result.submittedAt])).digest("hex");
      (result.reviews ??= []).push({ reviewer: input.reviewer, verdict: input.verdict, feedback: input.feedback, sourceHash, revision: input.expectedRevision + 1, reviewedAt: this.now().toISOString() });
      result.explanationReview = input.verdict === "withdrawn" ? "withdrawn" : "human_reviewed";
      return this.save(trial);
    })();
  }
  /** Used only on a newly restored database; old workspace/session identities stay untouched. */
  remapSessions(ids: ReadonlyMap<string, string>): void {
    this.database.db.transaction(() => {
      const rows = this.database.db.prepare("SELECT id,topic FROM learning_outcomes").all() as { id: string; topic: string }[];
      for (const row of rows) {
        const trial = this.read(row.topic, row.id);
        const mapped = trial.sessionId && ids.get(trial.sessionId);
        if (mapped) {
          trial.sessionId = z.string().uuid().parse(mapped);
          if (trial.lesson) trial.lesson.sessionId = mapped;
          this.save(trial);
        }
      }
    })();
  }
}

/** Paired score differences are descriptive observations, never causal/mastery claims. */
export function summarizeOutcomes(trials: OutcomeView[]): OutcomeSummary {
  const report: OutcomeSummary = { conclusion: "descriptive_only", total: trials.length, incomplete: 0, exclusions: {}, groups: [] };
  const values = new Map<string, { group: OutcomeSummary["groups"][number]; immediate: number[]; delayed: number[] }>();
  const exclude = (reason: string) => { report.exclusions[reason] = (report.exclusions[reason] ?? 0) + 1; };
  const independent = (result?: OutcomeResult) => result?.assistance === "independent";
  const difference = (before: OutcomeResult, after: OutcomeResult) => 100 * (after.correctCount / after.total - before.correctCount / before.total);
  for (const trial of trials) {
    if (trial.stage !== "complete") report.incomplete++;
    if (trial.stage === "abandoned" && !trial.results.post) { exclude("abandoned_before_post"); continue; }
    if (!trial.lesson) { exclude("no_lesson"); continue; }
    const conditions = trial.lesson.conditions;
    if (conditions.some(c => c.provider === "demo")) { exclude("demo"); continue; }
    if (conditions.some(c => !c.model)) { exclude("unknown_model"); continue; }
    if (new Set(conditions.map(c => JSON.stringify(c))).size !== 1) { exclude("changed_conditions"); continue; }
    if (trial.repeated) { exclude("repeated"); continue; }
    if (!trial.results.pre || !trial.results.post) { exclude("missing_post"); continue; }
    if (!independent(trial.results.pre) || !independent(trial.results.post)) { exclude("assisted"); continue; }
    if (trial.protocol === "full_product" && (!trial.provenance || conditions.some(c => c.codeHash !== trial.provenance?.codeHash))) { exclude("unknown_or_changed_build"); continue; }
    const c = conditions[0]!; const label = `${trial.topicId} · ${trial.protocol === "full_product" ? "完整产品" : "提示方式"} · v${trial.bankVersion} · ${c.provider}/${c.model} · ${c.reasoning}/${c.style}${c.codeHash ? ` · ${c.codeHash.slice(0, 12)}` : ""}${c.windowTokens ? ` · ${c.windowTokens}/${c.reserveOutputTokens}` : ""}`;
    const key = JSON.stringify([trial.topicId, trial.bankVersion, trial.protocol ?? "prompt_only", c, trial.mode]);
    const entry = values.get(key) ?? { group: { label, mode: trial.mode, independentPairs: 0, retentionPairs: 0, scoreChange: null, retentionChange: null }, immediate: [], delayed: [] };
    entry.immediate.push(difference(trial.results.pre, trial.results.post));
    if (trial.results.delayed) {
      if (independent(trial.results.delayed)) entry.delayed.push(difference(trial.results.pre, trial.results.delayed));
      else exclude("assisted_retention");
    }
    values.set(key, entry);
  }
  for (const { group, immediate, delayed } of values.values()) {
    group.independentPairs = immediate.length; group.retentionPairs = delayed.length;
    group.scoreChange = immediate.length ? immediate.reduce((a, b) => a + b, 0) / immediate.length : null;
    group.retentionChange = delayed.length ? delayed.reduce((a, b) => a + b, 0) / delayed.length : null;
    report.groups.push(group);
  }
  return report;
}
