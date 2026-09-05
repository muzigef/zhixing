import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConversationSessionStore, emptyConversation, conversationHistory } from "../src/conversation-session.js";
import { PathPolicy } from "../src/paths.js";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
async function setup() { const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-conversation-")); roots.push(root); return { root, store: new ConversationSessionStore(new PathPolicy(root)) }; }
describe("durable conversational context", () => {
  it("resumes current-topic chat including an interrupted response", async () => {
    const { store } = await setup();
    const session = emptyConversation("rag");
    session.turns.push({ user: "解释检索", assistant: "先看召回，再看", status: "interrupted" });
    await store.save(session);
    const restored = await store.current("rag");
    expect(restored?.id).toBe(session.id);
    expect(conversationHistory(restored!)).toEqual(["用户：解释检索", "助手（未完成）：先看召回，再看"]);
    expect(await store.current("agent-development")).toBeUndefined();
  });
  it("starts fresh without deleting a previous session and can select it again", async () => {
    const { store } = await setup();
    const first = emptyConversation("rag"); first.turns.push({ user: "旧问题", assistant: "旧答案", status: "completed" }); await store.save(first);
    const second = emptyConversation("rag"); await store.save(second);
    expect((await store.current("rag"))?.id).toBe(second.id);
    const restored = await store.load("rag", first.id); await store.save(restored);
    expect(conversationHistory((await store.current("rag"))!)).toContain("助手：旧答案");
    expect((await store.list("rag")).map((session) => session.id)).toContain(second.id);
  });
  it("bounds turns and text, and treats a killed running turn as interrupted", async () => {
    const { store } = await setup();
    const session = emptyConversation("rag");
    for (let i = 0; i < 10; i++) session.turns.push({ user: `问题${i}`, assistant: "字".repeat(12_000), status: "running" });
    await store.save(session);
    const restored = await store.current("rag");
    expect(restored?.turns).toHaveLength(6);
    expect(restored?.turns[0]?.user).toBe("问题4");
    expect(restored?.goal).toBe("问题0");
    expect(conversationHistory(restored!).slice(-10).join("\n")).toContain("问题0");
    expect(restored?.turns.at(-1)?.assistant.length).toBeLessThanOrEqual(8_000);
    expect(restored?.turns.at(-1)?.assistant).toContain("已截断");
    expect(restored?.turns.at(-1)?.status).toBe("interrupted");
  });
  it("can reload a full-size Unicode and escaped-text conversation", async () => {
    const { store } = await setup();
    const session = emptyConversation("rag");
    for (let i = 0; i < 6; i++) session.turns.push({ user: "问".repeat(8_000), assistant: "\u0001".repeat(8_000), status: "completed" });
    const saved = await store.save(session);
    expect(await store.current("rag")).toEqual(saved);
  });
  it("rejects cross-topic files, traversal and symlinked state", async () => {
    const { store, root } = await setup();
    const session = emptyConversation("rag"); await store.save(session);
    await expect(store.load("rag", "../other")).rejects.toThrow();
    const paths = new PathPolicy(root);
    const file = paths.resolveTopicPath("rag", "sessions", `chat-${session.id}.json`);
    await fs.writeFile(file, JSON.stringify({ ...session, topicId: "agent-development" }));
    await expect(store.current("rag")).rejects.toThrow("cross_topic_denied");
    await fs.unlink(file); await fs.symlink(path.join(root, "outside"), file);
    await expect(store.save(session)).rejects.toThrow("denied");
  });
});
