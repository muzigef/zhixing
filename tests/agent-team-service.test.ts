import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { AgentService } from "../src/agent-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
import { teamConfigurationSchema } from "../src/team-contracts.js";
import type { ModelClient } from "../src/model.js";

it("keeps single default and persists an actual team through the shared headless transport", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-team-service-")); let calls = 0;
  const client: ModelClient = { async *stream(_prompt, _signal, options) { calls++; yield { type: "text_delta", text: options?.messages?.some(item => item.content.includes("TEAM_PLAN")) ? '{"tasks":["核查计算","检查条件"]}' : "计算结果是 4。" }; yield { type: "usage", usage: { inputTokens: 10, outputTokens: 20 } }; yield { type: "done" }; } };
  const service = new AgentService(new AgentSessionStore(root), () => client);
  try {
    const session = await service.create(); const request = { sessionId: session.id, provider: "mock" as const, style: "adaptive" as const, text: "2+2?" };
    await service.invoke(request); expect(calls).toBe(1); expect((await service.load(session.id)).messages.at(-1)?.team).toBeUndefined();
    const reply = await service.invoke({ ...request, collaboration: teamConfigurationSchema.parse({ mode: "same-model-team" }) });
    expect(calls).toBe(5); expect(reply.team?.status).toBe("completed");
    const message = (await new AgentSessionStore(root).load(session.id)).messages.at(-1)!;
    expect((await new AgentSessionStore(root).load(session.id)).version).toBe(9);
    expect(JSON.parse(await fs.readFile(path.join(root, "conversations", `${session.id}.json.v8.bak`), "utf8")).version).toBe(8);
    expect(message.team?.members).toHaveLength(2); expect(message.collaboration?.mode).toBe("same-model-team");
    await expect(service.send({ ...request, resumeTaskId: message.taskId, collaboration: teamConfigurationSchema.parse({ mode: "single" }) })).rejects.toThrow("team_configuration_changed");
    const again = await service.invoke({ ...request, collaboration: message.collaboration });
    expect(calls).toBe(9); expect(again.team?.id).not.toBe(message.team?.id); expect(again.taskId).not.toBe(message.taskId);
    expect((await service.load(session.id)).messages.find(item => item.id === message.id)?.team?.id).toBe(message.team?.id);
  } finally { service.stop(); await service.idle(); await service.pauseMaintenance(); await fs.rm(root, { recursive: true, force: true }); }
});
