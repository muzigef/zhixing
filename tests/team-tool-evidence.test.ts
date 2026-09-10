import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { LearningApplication } from "../src/learning-application.js";
import { TeamCoordinator } from "../src/team-coordinator.js";
import { teamConfigurationSchema } from "../src/team-contracts.js";
import { AgentExecutionStore } from "../src/agent-execution-store.js";
import type { ContinuableModelClient } from "../src/model.js";

it.each([false, true])("uses the actual shared read-only tool loop and rejects forged receipts=%s", async forged => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-team-receipt-")); const app = await LearningApplication.open(root, process.cwd());
  const sessionId = randomUUID(); let tools = 0;
  const client: ContinuableModelClient = { identity: { provider: "mock", model: "mock", connection: "local" }, async *stream(_prompt, _signal, options) {
    const system = options?.messages?.filter(item => item.role === "system").map(item => item.content).join("\n") ?? "";
    if (system.includes("TEAM_MEMBER")) {
      expect(options?.tools?.map(tool => tool.name)).toContain("learning_progress");
      expect(options?.tools?.some(tool => ["save_artifact", "plan_task", "ask_user"].includes(tool.name))).toBe(false);
      tools++; yield { type: "tool_call", tool: "learning_progress", input: {}, callId: "actual-progress" };
    } else {
      const text = system.includes("TEAM_PLAN") ? '{"tasks":[{"id":"progress","member":1,"goal":"读取学习进度","dependsOn":[],"acceptance":["依据实际查询结果说明进度"]}]}' : system.includes("TEAM_REVIEW") ? '{"verdict":"uncertain","issues":["需要人工核对教学目标"],"guidance":"只陈述实际读取结果","followUp":null}' : "已完成本次进度查询。";
      yield { type: "text_delta", text };
    }
    yield { type: "usage", usage: { inputTokens: 20, outputTokens: 20 } }; yield { type: "done" };
  }, async *continue(_prompt, results, _signal, options) {
    const response = (results.find(result => result.tool === "learning_progress") ?? options?.history?.flatMap(turn => turn.toolResults ?? []).find(result => result.tool === "learning_progress"))?.result as { ok: boolean; output: unknown; receipt: { id: string } };
    expect(response?.ok).toBe(true); expect(response.receipt.id).toHaveLength(64);
    yield { type: "text_delta", text: JSON.stringify({ summary: "已查询进度", claims: [{ key: "progress", value: "已读取", basis: "通过 learning_progress 返回的当前学习进度", evidenceIds: [forged ? "f".repeat(64) : response.receipt.id] }], uncertainties: [] }) };
    yield { type: "usage", usage: { inputTokens: 20, outputTokens: 20 } }; yield { type: "done" };
  } };
  try {
    const signal = new AbortController().signal;
    const team = await TeamCoordinator.create({ config: teamConfigurationSchema.parse({ mode: "same-model-team", shareContext: true, members: [{ role: "material-checker" }] }), provider: "mock", resolve: () => client, reasoning: "balanced", scope: "rag-test", question: "读取当前学习进度", save: async () => {} }, signal);
    const result = await team.run({ runId: randomUUID(), taskId: randomUUID(), sessionId, providerId: "mock", client, application: app, topicId: "rag", contextAllowed: true, permissions: { version: 1, materials: true }, question: "读取当前学习进度", prompt: "读取当前学习进度", messages: [{ role: "user", content: "读取当前学习进度" }], onText: () => {}, onActivity: () => {}, onCitation: () => {} }, signal);
    expect(tools).toBe(1); const task = team.snapshot.tasks![0]!;
    expect(task.evidence).toHaveLength(1); expect(task.evidence![0]).toMatchObject({ executionId: task.executionId, tool: "learning_progress", ok: true });
    expect(task.status).toBe(forged ? "failed" : "completed"); expect(Boolean(result.blocked)).toBe(forged);
    const journal = new AgentExecutionStore(app.database, { taskId: task.executionId!, sessionId, topicId: "rag" }).read();
    expect(JSON.stringify(journal)).toContain(task.evidence![0]!.id);
    expect(team.snapshot.verification?.status).toBe("unresolved");
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
});
