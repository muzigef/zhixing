import { createHash } from "node:crypto";
import { z } from "zod/v4";
import type { ZhixingDatabase } from "./database.js";
import { topicIdSchema } from "./contracts.js";

/** Bounded durable payloads; only a task's authorized tools can read its own pages. */
export class ToolResultStore {
  constructor(private readonly database: ZhixingDatabase, private readonly taskId: string) {
    z.string().uuid().parse(taskId);
    database.db.exec("CREATE TABLE IF NOT EXISTS tool_result_payloads (task_id TEXT NOT NULL, topic TEXT NOT NULL, id TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(task_id,topic,id))");
  }
  retain(topic: string, payload: string): { resultId: string } | undefined {
    topicIdSchema.parse(topic);
    if (Buffer.byteLength(payload) > 256_000) return undefined;
    const resultId = createHash("sha256").update(`${this.taskId}:${topic}:${payload}`).digest("hex");
    return this.database.db.transaction(() => {
      const existing = this.database.db.prepare("SELECT 1 FROM tool_result_payloads WHERE task_id=? AND topic=? AND id=?").get(this.taskId, topic, resultId);
      if (existing) return { resultId };
      const used = this.database.db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(length(CAST(payload AS BLOB))),0) AS bytes FROM tool_result_payloads WHERE task_id=?").get(this.taskId) as { count: number; bytes: number };
      if (used.count >= 64 || used.bytes + Buffer.byteLength(payload) > 1_000_000) return undefined;
      this.database.db.prepare("INSERT INTO tool_result_payloads VALUES (?,?,?,?)").run(this.taskId, topic, resultId, payload);
      return { resultId };
    })();
  }
  read(topic: string, resultId: string, offset: number) {
    topicIdSchema.parse(topic); z.string().regex(/^[a-f0-9]{64}$/).parse(resultId); z.number().int().min(0).max(256_000).parse(offset);
    const row = this.database.db.prepare("SELECT payload FROM tool_result_payloads WHERE task_id=? AND topic=? AND id=?").get(this.taskId, topic, resultId) as { payload: string } | undefined;
    if (!row || offset > row.payload.length) throw new Error("tool_result_not_found");
    const content = row.payload.slice(offset, offset + 5000); const next = offset + content.length;
    return { resultId, format: "json", offset, totalChars: row.payload.length, content, nextOffset: next < row.payload.length ? next : null };
  }
}
