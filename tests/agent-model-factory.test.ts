import { expect, it } from "vitest";
import { createAgentModel } from "../src/agent-model-factory.js";
import { isContinuableModelClient } from "../src/model.js";
import { capabilitiesFor, effectiveModelBudget } from "../src/model-capabilities.js";
import { PiApplicationClient } from "../src/pi-application-client.js";
const environment = { ZHIXING_ALLOW_LIVE_PROVIDER: "0", ZHIXING_CONTEXT_WINDOW_TOKENS: "12000", ZHIXING_OUTPUT_TOKENS: "2000" };
const options = { environment, pi: new PiApplicationClient({ projectDir: "/synthetic", executable: "node", worker: "worker.mjs", sdk: "sdk.mjs", environment }), secrets: { get: async () => undefined, set: async () => undefined, delete: async () => false } };
it.each(["pi-codex", "deepseek-api"] as const)("shares tool continuation, budgets and the offline gate for %s", async provider => {
  const client = createAgentModel(provider, options);
  expect(isContinuableModelClient(client)).toBe(true);
  expect(capabilitiesFor(client)).toMatchObject({ toolCalling: true, continuation: true, outputLimit: "configurable" });
  expect(effectiveModelBudget(client)).toEqual({ windowTokens: 12000, reserveOutputTokens: 2000 });
  await expect(client.stream("synthetic", new AbortController().signal)[Symbol.asyncIterator]().next()).rejects.toThrow("live_provider_disabled");
});
