import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { LearningApplication } from "../src/learning-application.js";
import { AgentService } from "../src/agent-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const apps: LearningApplication[] = [];
afterEach(async () => { for (const app of apps.splice(0)) { app.close(); await fs.rm(app.root, { recursive: true, force: true }); } });
async function fixture() {
  const app = await LearningApplication.open(await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-memory-revision-")), process.cwd()); apps.push(app);
  app.database.writeMemory("old", { topicId: "rag", type: "learning_fact", content: "缓存示例使用数组", sourceKind: "user", sourceRef: "user:original", confidence: 1, confirmed: true });
  const original = app.database.readMemory("rag", "old")!;
  return { app, input: { id: "old", expectedHash: original.contentHash, content: "缓存示例改用字典" } };
}
it("supersedes a confirmed fact atomically and retains original provenance across restart", async () => {
  const { app, input } = await fixture(); const db = app.database;
  const corrected = db.correctMemory("rag", input);
  expect(db.searchMemories("rag", "缓存示例").map(row => row.content)).toEqual([input.content]);
  expect(db.readMemory("rag", "old")).toMatchObject({ content: "缓存示例使用数组", sourceRef: "user:original", status: "superseded", supersededBy: corrected.id });
  expect(db.correctMemory("rag", input)).toEqual(corrected);
  const reopened = await LearningApplication.open(app.root); try {
    expect((await reopened.memory.snapshot("rag", "缓存示例")).memories.map(row => row.id)).toEqual([corrected.id]);
    expect(reopened.database.searchAllMemories("缓存示例").map(row => row.id)).toEqual([corrected.id]);
  } finally { reopened.close(); }
});
it("rejects stale corrections and cross-topic identity without partial writes", async () => {
  const { app, input } = await fixture();
  expect(() => app.database.correctMemory("tool-calling", input)).toThrow("memory_not_found");
  expect(() => app.database.correctMemory("rag", { ...input, expectedHash: "0".repeat(64) })).toThrow("memory_changed");
  const replacement = app.database.correctMemory("rag", input);
  expect(() => app.database.correctMemory("rag", { ...input, content: "另一项更正" })).toThrow("memory_changed");
  expect(app.database.searchMemories("rag", "缓存")).toHaveLength(1);
  app.database.deleteMemory("rag", replacement.id);
  expect(app.database.searchMemories("rag", "缓存")).toEqual([]);
  expect(() => app.database.correctMemory("rag", input)).toThrow("memory_changed");
});
it("exposes the same bounded correction preview through shared tools and enforces write capability", async () => {
  const { app, input } = await fixture();
  const tools = app.tools(true, { taskId: crypto.randomUUID(), allowWrites: false });
  const context = { topicId: "rag", signal: new AbortController().signal };
  const preview = await tools.harness.validatedPreview("correct_memory", input, context);
  expect(preview.preview).toContain("缓存示例使用数组"); expect(preview.preview).toContain(input.content);
  expect(await tools.harness.execute("correct_memory", input, context)).toMatchObject({ ok: false, errorCode: "tool_policy_denied" });
  expect(await tools.harness.execute("correct_memory", input, { ...context, maxRisk: "write" })).toMatchObject({ ok: true });
  expect(app.database.searchMemories("rag", "缓存示例")).toHaveLength(1);
});
it("requires an exact correction decision even with a general session write grant", async () => {
  const { app, input } = await fixture();
  const client = { async *stream() { yield { type: "tool_call" as const, tool: "correct_memory", input, callId: "correction-1" }; yield { type: "done" as const }; }, async *continue() { yield { type: "text_delta" as const, text: "记忆更正已完成。" }; yield { type: "done" as const }; } };
  const service = new AgentService(new AgentSessionStore(path.join(app.root, "sessions")), () => client, app);
  try {
    const session = await service.create();
    await service.send({ sessionId: session.id, text: "缓存示例改用字典", provider: "mock", style: "adaptive", topicId: "rag", access: { materials: true, project: false, external: false }, execution: "session" }); await service.idle();
    const saved = await service.load(session.id); expect(saved.messages.at(-1)?.status).toBe("waiting");
    const card = saved.messages.at(-1)?.items?.find(item => item.kind === "approval");
    expect(card).toMatchObject({ tool: "correct_memory", input });
    expect(app.database.searchMemories("rag", "缓存")[0]?.id).toBe("old");
    await service.answerInteraction(session.id, card!.id, "allow"); await service.idle();
    expect(app.database.searchMemories("rag", "缓存")[0]?.content).toBe(input.content);
  } finally { service.stop(); await service.idle(); await service.pauseMaintenance(); }
});
it("persists an explicit CLI correction through a separate process", async () => {
  const { app } = await fixture();
  const result = await promisify(execFile)(process.execPath, ["--import", "tsx", "src/cli.ts", "更正记忆 old 缓存示例改用字典 --确认", "--topic", "rag"], { cwd: process.cwd(), timeout: 15_000, env: { ...process.env, ZHIXING_ROOT: app.root, ZHIXING_ALLOW_LIVE_PROVIDER: "0" } });
  expect(result.stdout).toContain("已更正记忆");
  expect(app.database.searchMemories("rag", "缓存示例").map(row => row.content)).toEqual(["缓存示例改用字典"]);
});
