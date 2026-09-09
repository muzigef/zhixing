import { describe, expect, it } from "vitest";
import { teamConfigurationSchema, modelBindingSchema, validateTeamBindings } from "../src/team-contracts.js";
import { agentSendSchema, chatSchema } from "../src/agent-session-contracts.js";
import { PiApplicationClient } from "../src/pi-application-client.js";
import { bindAgentModel } from "../src/agent-model-binding.js";
import { createAgentModel } from "../src/agent-model-factory.js";
import { MemorySecretStore } from "../src/secret-store.js";
import { withModelBudget } from "../src/model-capabilities.js";

const binding = (provider = "deepseek-api", model = "synthetic-model") => modelBindingSchema.parse({ provider, model, connection: "https://synthetic.example/v1", reasoning: "balanced" });
describe("shared collaboration and frozen model contracts", () => {
  it("defaults existing sessions/requests to single and rejects recursive/oversized teams", () => {
    expect(teamConfigurationSchema.parse({}).mode).toBe("single");
    const request = agentSendSchema.parse({ sessionId: crypto.randomUUID(), text: "测试", provider: "deepseek-api", style: "adaptive" });
    expect(request.collaboration?.mode ?? "single").toBe("single");
    const now = new Date().toISOString();
    expect(chatSchema.parse({ version: 8, id: request.sessionId, title: "旧对话", messages: [], createdAt: now, updatedAt: now }).collaboration?.mode ?? "single").toBe("single");
    expect(teamConfigurationSchema.safeParse({ mode: "same-model-team", members: [{ role: "reasoning-checker" }, { role: "material-checker" }, { role: "practice-reviewer" }] }).success).toBe(false);
    expect(teamConfigurationSchema.safeParse({ mode: "same-model-team", recursive: true }).success).toBe(false);
  });
  it("requires real model differences for mixed teams and identical binding for same-model teams", () => {
    expect(() => validateTeamBindings("same-model-team", binding(), [binding(), binding()])).not.toThrow();
    expect(() => validateTeamBindings("same-model-team", binding(), [binding("kimi-api")])).toThrow("team_model_mismatch");
    expect(() => validateTeamBindings("mixed-model-team", binding(), [binding()])).toThrow("team_models_not_distinct");
    expect(() => validateTeamBindings("mixed-model-team", binding(), [binding("kimi-api", "synthetic-other")])).not.toThrow();
  });
  it("pins Pi settings once, preserves budget wrappers and passes the pinned selection to all worker turns", async () => {
    let current = "model-a"; const selections: string[] = [];
    const pi = new PiApplicationClient({ projectDir: "/unused", executable: "node", worker: "unused", sdk: "unused", environment: {}, runner: async function* (request) {
      selections.push(JSON.parse(request.input).selection.model);
      yield { type: "stdout", data: Buffer.from('{"type":"text_delta","text":"合成回答"}\n{"type":"done"}\n') }; yield { type: "exit", code: 0 };
    } });
    pi.selection = async () => ({ provider: "openai-codex", model: current, thinking: "medium" });
    const pinned = await bindAgentModel("pi-codex", withModelBudget(pi, { windowTokens: 8000, reserveOutputTokens: 1024 }), "balanced", new AbortController().signal);
    current = "model-b";
    for (let i = 0; i < 2; i++) for await (const _event of pinned.client.stream("测试", new AbortController().signal)) { expect(_event.type).toBeTruthy(); }
    expect(selections).toEqual(["model-a", "model-a"]);
    expect(pinned.binding).toMatchObject({ provider: "pi-codex", model: "model-a" });
    expect(pinned.client.contextBudget).toEqual({ windowTokens: 8000, reserveOutputTokens: 1024 });
  });
  it("snapshots API model identity and rejects a mismatched restored binding", async () => {
    const pi = new PiApplicationClient({ projectDir: "/unused", executable: "node", worker: "unused", sdk: "unused" });
    const client = createAgentModel("deepseek-api", { pi, secrets: new MemorySecretStore(), deepseekModel: "deepseek-v4-flash", environment: {} });
    const pinned = await bindAgentModel("deepseek-api", client, "quick", new AbortController().signal);
    expect(pinned.binding).toMatchObject({ provider: "deepseek-api", model: "deepseek-v4-flash", reasoning: "quick" });
    await expect(bindAgentModel("deepseek-api", client, "quick", new AbortController().signal, { ...pinned.binding, model: "deepseek-v4-pro" })).rejects.toThrow("team_model_mismatch");
  });
});
