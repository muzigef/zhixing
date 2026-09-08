import { z } from "zod/v4";
import type { ZhixingDatabase } from "./database.js";
import { topicIdSchema } from "./contracts.js";
import { dayIdSchema } from "./evidence-store.js";
import { matchingConcepts, reviewRequest } from "./learning-concepts.js";
export const conceptEvidenceSchema = z.object({ conceptId: z.string().max(80), catalogVersion: z.string().max(40), questionIndex: z.number().int().nonnegative(), correct: z.boolean(), explanation: z.string().max(2000) });
export const assistanceSchema = z.enum(["independent", "hint", "solution", "unknown"]);
export type Assistance = z.infer<typeof assistanceSchema>;
const revisionSchema = z.object({ revision: z.number().int().positive(), annotation: z.string().max(2000), withdrawn: z.boolean(), at: z.string().datetime() });
export const observationSchema = z.object({ id: z.string().uuid(), topicId: topicIdSchema, source: z.object({ kind: z.literal("assessment"), dayId: dayIdSchema }), original: z.string().max(4000), assistance: assistanceSchema, correctCount: z.number().int().nonnegative(), total: z.number().int().positive(), concepts: z.array(conceptEvidenceSchema).max(20).optional(), errorCauses: z.array(z.string()).max(10), submittedAt: z.string().datetime(), revision: z.number().int().positive(), annotation: z.string().max(2000), withdrawn: z.boolean(), changes: z.array(revisionSchema).max(100) });
export type LearningObservation = z.infer<typeof observationSchema>;
/** Source submissions stay immutable. Corrections and withdrawals are explicit, local user actions. */
export class LearningObservations {
  constructor(private readonly database: ZhixingDatabase) { database.db.exec("CREATE TABLE IF NOT EXISTS learning_observations(id TEXT PRIMARY KEY, topic TEXT NOT NULL, value TEXT NOT NULL)"); }
  capture(topic: string, id: string): void {
    topicIdSchema.parse(topic); z.string().uuid().parse(id);
    const row = this.database.db.prepare("SELECT topic,day,result FROM learning_assessments WHERE id=?").get(id) as { topic: string; day: string; result: string | null } | undefined;
    if (!row?.result) throw new Error("observation_submission_required");
    if (row.topic !== topic) throw new Error("cross_topic_denied");
    const result = JSON.parse(row.result);
    const observation = observationSchema.parse({ id, topicId: topic, source: { kind: "assessment", dayId: row.day }, original: result.reflection, assistance: result.assistance ?? "unknown", correctCount: result.correctCount, total: result.total, concepts: result.concepts, errorCauses: result.errorCauses, submittedAt: result.submittedAt, revision: 1, annotation: "", withdrawn: false, changes: [] });
    this.database.db.prepare("INSERT OR IGNORE INTO learning_observations(id,topic,value) VALUES(?,?,?)").run(id, topic, JSON.stringify(observation));
  }
  list(topic: string): LearningObservation[] {
    topicIdSchema.parse(topic);
    const rows = this.database.db.prepare("SELECT value FROM learning_observations WHERE topic=? ORDER BY rowid DESC LIMIT 100").all(topic) as { value: string }[];
    return rows.map(row => { const value = observationSchema.parse(JSON.parse(row.value)); if (value.topicId !== topic) throw new Error("cross_topic_denied"); return value; });
  }
  update(topic: string, id: string, revision: number, annotation: string, withdrawn: boolean): LearningObservation {
    topicIdSchema.parse(topic); z.string().uuid().parse(id); z.number().int().positive().parse(revision); z.string().max(2000).parse(annotation); z.boolean().parse(withdrawn);
    return this.database.db.transaction(() => {
      const row = this.database.db.prepare("SELECT topic,value FROM learning_observations WHERE id=?").get(id) as { topic: string; value: string } | undefined;
      if (!row) throw new Error("observation_not_found"); if (row.topic !== topic) throw new Error("cross_topic_denied");
      const value = observationSchema.parse(JSON.parse(row.value));
      if (value.revision !== revision || value.changes.length >= 100) throw new Error("observation_conflict");
      value.revision++; value.annotation = annotation; value.withdrawn = withdrawn;
      value.changes.push({ revision: value.revision, annotation, withdrawn, at: new Date().toISOString() });
      this.database.db.prepare("UPDATE learning_observations SET value=? WHERE id=? AND topic=?").run(JSON.stringify(value), id, topic); return value;
    })();
  }
  context(topic: string, query: string) {
    const matching = matchingConcepts(topic, query);
    if (!matching.length && !reviewRequest(query)) return [];
    return this.list(topic).filter(item => !item.withdrawn && (!matching.length || item.concepts?.some(result => matching.some(concept => concept.id === result.conceptId)))).slice(0, 3).map(item => ({ source: { id: item.id, revision: item.revision, ...item.source, submittedAt: item.submittedAt }, actualLearnerReflection: item.original.slice(0, 1000), assistance: item.assistance, choiceResult: `${item.correctCount}/${item.total}`, errorCauses: item.errorCauses, learnerCorrection: item.annotation.slice(0, 1000), interpretation: "仅是这次实际作答的记录，不代表整体掌握；自报帮助方式与选择题分数分别看待。" }));
  }
}
