import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { AgentService } from "../src/agent-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { LearningApplication } from "../src/learning-application.js";
import type { ContinuableModelClient, ModelRequestOptions } from "../src/model.js";

const roots: string[] = []; const apps: LearningApplication[] = [];
afterEach(async () => { apps.splice(0).forEach(app => app.close()); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture(client: ContinuableModelClient) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-efficiency-")); roots.push(root);
  const app = await LearningApplication.open(root, process.cwd()); apps.push(app);
  const store = new AgentSessionStore(path.join(root, "chats"));
  return { app, store, service: new AgentService(store, () => client, app) };
}

it.each([
  ["auto", "2+2 等于多少？", "quick"], ["auto", "请逐步推导梯度公式并证明", "deep"], ["quick", "请逐步推导梯度公式并证明", "quick"], ["auto", "请比较两个缓存方案的适用条件和取舍".repeat(10), "balanced"],
] as const)("resolves %s for %s to %s without overriding an explicit profile", async (requested, text, expected) => {
  let options: ModelRequestOptions | undefined;
  const client: ContinuableModelClient = { async *stream(_prompt, _signal, value) { options = value; yield { type: "text_delta", text: "合成回答" }; yield { type: "done" }; }, async *continue() { throw new Error("unexpected continuation"); yield { type: "done" }; } };
  const { service } = await fixture(client); const session = await service.create();
  await service.send({ sessionId: session.id, provider: "mock", style: "adaptive", reasoning: requested, text }); await service.idle();
  expect(options?.reasoning).toBe(expected); expect((await service.load(session.id)).messages.at(-1)?.reasoning).toBe(expected);
});

it("discovers practice schemas on demand and executes a real artifact through the same approval boundary", async () => {
  let turn = 0; const advertised: string[][] = [];
  const client: ContinuableModelClient = {
    async *stream(_prompt, _signal, options) { advertised.push(options!.tools!.map(tool => tool.name)); yield { type: "tool_call", tool: "discover_tools", input: { category: "practice" }, callId: "discover" }; yield { type: "done" }; },
    async *continue(_prompt, results, _signal, options) {
      advertised.push(options!.tools!.map(tool => tool.name));
      if (++turn === 1) {
        expect(JSON.stringify(results)).toContain("save_artifact");
        yield { type: "tool_call", tool: "save_artifact", input: { dayId: "D01", kind: "implementation", text: "export const value = 42;" }, callId: "save" };
      } else yield { type: "text_delta", text: "已完成合成任务" };
      yield { type: "done" };
    },
  };
  const { app, store, service } = await fixture(client); await app.handle("开始第 1 天", "agent-development"); const session = await service.create();
  await service.send({ sessionId: session.id, provider: "mock", style: "adaptive", topicId: "agent-development", contextAllowed: true, text: "保存合成实现" }); await service.idle();
  const waiting = (await service.load(session.id)).messages.at(-1)!;
  expect(advertised[0]).toContain("discover_tools"); expect(advertised[0]).not.toContain("save_artifact"); expect(advertised[1]).toContain("save_artifact");
  expect(waiting.status).toBe("waiting"); expect((await app.evidence.list("agent-development", "D01")).artifacts).toHaveLength(0);
  const approval = waiting.items!.find(item => item.kind === "approval")!;
  const restarted = new AgentService(store, () => client, app);
  await restarted.answerInteraction(session.id, approval.id, "allow"); await restarted.idle();
  expect((await app.evidence.list("agent-development", "D01")).artifacts).toHaveLength(1);
  expect((await service.load(session.id)).messages.at(-1)).toMatchObject({ status: "completed", taskId: waiting.taskId });
});

it("does not advertise application discovery without material consent", async () => {
  let definitions: string[] = [];
  const client: ContinuableModelClient = { async *stream(_prompt, _signal, options) { definitions = options?.tools?.map(tool => tool.name) ?? []; yield { type: "text_delta", text: "普通回答" }; yield { type: "done" }; }, async *continue() { throw new Error("unexpected continuation"); yield { type: "done" }; } };
  const { service } = await fixture(client); const session = await service.create();
  await service.send({ sessionId: session.id, provider: "mock", style: "adaptive", reasoning: "auto", text: "帮我看看材料", topicId: "agent-development", contextAllowed: false }); await service.idle();
  expect(definitions).not.toContain("discover_tools"); expect(definitions).not.toContain("read_material");
  expect((await service.load(session.id)).messages.at(-1)).toMatchObject({ reasoningMode: "auto", reasoning: "quick" });
});
