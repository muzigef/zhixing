import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { PiApplicationClient } from "../src/pi-application-client.js";
import type { PiProcessRequest, PiProcessRunner } from "../src/pi-client.js";
import type { ModelEvent } from "../src/model.js";

it("bridges native structured tool turns through stdin without enabling any native execution", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-pi-bridge-"));
  try {
    await fs.writeFile(path.join(root, "settings.json"), JSON.stringify({ defaultProvider: "openai-codex", defaultModel: "fixture" }));
    const requests: PiProcessRequest[] = [];
    const runner: PiProcessRunner = async function* (request) { requests.push(request); yield { type: "stdout", data: Buffer.from([ { type: "tool_call", tool: "learning_progress", input: {}, callId: "1" }, { type: "provider_state", result: { provider: "openai-codex", model: "fixture", role: "assistant" } }, { type: "done" } ].map((event) => JSON.stringify(event)).join("\n")) }; yield { type: "exit", code: 0 }; };
    const client = new PiApplicationClient({ projectDir: root, executable: "node", worker: "worker.mjs", sdk: "sdk.js", environment: { PI_CODING_AGENT_DIR: root }, runner });
    const events: ModelEvent[] = [];
    for await (const event of client.stream("问", new AbortController().signal, { messages: [{ role: "system", content: "规则" }, { role: "user", content: "问" }], tools: [{ name: "learning_progress", description: "进度", inputSchema: { type: "object" } }] })) events.push(event);
    expect(events.map((event) => event.type)).toEqual(["tool_call", "provider_state", "done"]);
    expect(requests[0]?.args).toEqual(["worker.mjs", "sdk.js"]);
    const payload = JSON.parse(requests[0]!.input);
    expect(payload.options.messages[0].role).toBe("system");
    expect(payload.options.tools[0].name).toBe("learning_progress");
    expect(payload.selection.model).toBe("fixture");
    expect(requests[0]?.args.join(" ")).not.toContain("问");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
it("fails closed on missing done, untrusted tool results, and disabled live access", async () => {
  const client = new PiApplicationClient({ projectDir: ".", executable: "node", worker: "worker", sdk: "sdk", environment: { ZHIXING_ALLOW_LIVE_PROVIDER: "0" }, runner: async function* () { throw new Error("must not launch"); yield { type: "exit", code: 0 }; } });
  await expect(client.stream("x", new AbortController().signal)[Symbol.asyncIterator]().next()).rejects.toThrow("live_provider_disabled");
  await expect(client.continue("x", [], new AbortController().signal)[Symbol.asyncIterator]().next()).rejects.toThrow("provider_continuation_context_required");
});
