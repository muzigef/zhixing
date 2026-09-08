import { afterEach, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ZhixingDatabase } from "../src/database.js";
import { buildMessages } from "../src/learning-agent-profile.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { relevantExcerpt } from "../src/conversation-context.js";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-memory-quality-")); const db = new ZhixingDatabase(path.join(root, "db.sqlite"));
  cleanup.push(async () => { db.close(); await fs.rm(root, { recursive: true, force: true }); });
  const remember = (id: string, content: string, topicId = "rag") => db.writeMemory(id, { topicId, content, type: "learning_fact", sourceKind: "user", sourceRef: "user:explicit", confidence: 1, confirmed: true });
  return { root, db, remember };
}
it("recalls an older relevant memory using synonyms among many unrelated newer records", async () => {
  const { db, remember } = await fixture();
  remember("old-relevant", "缓存过期时需要刷新，不要沿用上一次结果。");
  for (let i = 0; i < 350; i++) remember(`noise-${i}`, `无关的课程计划 ${i}`);
  remember("other-topic", "cache invalidation 的私有记录", "tool-calling");
  expect(db.searchMemories("rag", "请解释 cache invalidation 时要遵守什么要求")[0]?.id).toBe("old-relevant");
  db.deleteMemory("rag", "old-relevant");
  expect(db.searchMemories("rag", "cache invalidation")).toEqual([]);
});
it("orders conflicting equally relevant user corrections by the most recent record, with their source", async () => {
  const { db, remember } = await fixture();
  remember("before", "缓存示例使用数组"); remember("after", "缓存示例改用字典");
  const records = db.searchMemories("rag", "缓存示例");
  expect(records.map(record => record.id)).toEqual(["after", "before"]);
  expect(records.every(record => record.sourceRef === "user:explicit")).toBe(true);
});
it("treats SQL wildcard characters as text and does not recall unrelated memories", async () => {
  const { db, remember } = await fixture(); remember("secret-topic-state", "这里是普通的课程记录");
  expect(db.searchMemories("rag", "%")).toEqual([]);
  expect(db.searchMemories("rag", "_")).toEqual([]);
});
it("preserves query-relevant facts in the middle of a long message, bounded and below instruction authority", async () => {
  const { root } = await fixture(); const session = await new AgentSessionStore(path.join(root, "chats")).create();
  const middle = "缓存有效期必须以版本号而不是日期判断";
  session.messages = [{ id: crypto.randomUUID(), role: "user", text: `开头说明\n${"背景填充。".repeat(2000)}\n${middle}\n${"其他说明。".repeat(2000)}\n末尾记录`, status: "completed", createdAt: session.createdAt }];
  const request = { sessionId: session.id, text: "缓存有效期应如何判断？", provider: "mock" as const, style: "adaptive" as const };
  const messages = buildMessages(session, request);
  const history = messages.filter(message => message.role === "user" && message.content !== request.text);
  expect(history[0]?.content).toContain(middle);
  expect(history[0]?.content.length).toBeLessThanOrEqual(6000);
  expect(messages.filter(message => message.role === "system").some(message => message.content.includes(middle))).toBe(false);
  expect(session.messages[0]?.text.length).toBeGreaterThan(20_000);
});
it("keeps relevant excerpts within small budgets without splitting emoji", () => {
  const text = `${"😀".repeat(400)}缓存有效期需要版本号${"😀".repeat(400)}`;
  for (const limit of [0, 99, 299, 300, 400, 600]) {
    const value = relevantExcerpt(text, limit, "缓存有效期");
    expect(value.length).toBeLessThanOrEqual(limit);
    expect(Array.from(value).some(character => /^[\uD800-\uDFFF]$/.test(character))).toBe(false);
  }
});
