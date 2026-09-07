import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { PiApplicationClient, type PiApplicationOptions } from "../src/pi-application-client.js";
import { runPiProcess, type PiProcessRunner } from "../src/pi-client.js";
import { collectInvocation } from "../src/model-invocation.js";
import { providerRuntime } from "../src/assistant-runtime.js";
import { DesktopService } from "../desktop/core/service.js";
import { DesktopStore } from "../desktop/core/store.js";
import type { ModelEvent } from "../src/model.js";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
async function fixture(runner?: PiProcessRunner, extra: Partial<PiApplicationOptions> = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-pi-latency-test-")); roots.push(root);
  await fs.writeFile(path.join(root, "settings.json"), JSON.stringify({ defaultProvider: "openai-codex", defaultModel: "fixture", defaultThinkingLevel: "medium" }));
  return { root, client: new PiApplicationClient({ projectDir: root, executable: "node", worker: "worker.mjs", sdk: "sdk.mjs", environment: { PI_CODING_AGENT_DIR: root }, runner, ...extra }) };
}
const frame = (...events: unknown[]) => ({ type: "stdout" as const, data: Buffer.from(events.map((event) => JSON.stringify(event)).join("\n") + "\n") });
const timing = { transport: "sse", startupMs: 10, requestMs: 100, firstEventMs: 20, firstTextMs: 90 };
async function collect(client: PiApplicationClient) { const events: ModelEvent[] = []; for await (const event of client.stream("问", new AbortController().signal)) events.push(event); return events; }

it("defaults to SSE and records process tail only after validated exit without changing reasoning", async () => {
  let now = 1000; vi.spyOn(Date, "now").mockImplementation(() => now);
  const { client } = await fixture(async function* (request) {
    const payload = JSON.parse(request.input);
    expect(payload.transport).toBe("sse"); expect(payload.selection.thinking).toBe("medium");
    now = 1200;
    yield frame({ type: "timing", timing }, { type: "done" });
    now = 1230; yield { type: "exit", code: 0 };
  });
  const events = await collect(client);
  expect(events.find((event) => event.type === "timing")?.timing).toMatchObject({ ...timing, processTailMs: 30, totalMs: 230 });
  expect(events.at(-1)?.type).toBe("done");
});

it("allows an explicit auto transport override and rejects invalid transport before starting a process", async () => {
  const { client } = await fixture(async function* (request) { expect(JSON.parse(request.input).transport).toBe("auto"); yield frame({ type: "done" }); yield { type: "exit", code: 0 }; }, { transport: "auto" });
  await collect(client);
  const bad = await fixture(async function* () { throw new Error("must not launch"); yield { type: "exit", code: 0 }; }, { environment: { ZHIXING_PI_TRANSPORT: "invalid" } });
  await expect(collect(bad.client)).rejects.toThrow("provider_transport_invalid");
});

it.each(["missing-done", "late-event", "failed-exit", "bad-timing"])("never executes buffered tools after %s", async (failure) => {
  const { client } = await fixture(async function* () {
    yield frame({ type: "tool_call", tool: "progress", input: {}, callId: "1" });
    if (failure === "bad-timing") yield frame({ type: "timing", timing: { ...timing, requestMs: -1 } });
    if (failure !== "missing-done") yield frame({ type: "done" });
    if (failure === "late-event") yield frame({ type: "progress", phase: "responding" });
    yield { type: "exit", code: failure === "failed-exit" ? 1 : 0 };
  });
  const execute = vi.fn();
  await expect(collectInvocation(providerRuntime("pi-codex", client), { role: "tutor", providerId: "pi-codex", prompt: "问", containsUserMaterials: false, confirmed: true, requireDone: true, onToolCall: execute }, new AbortController().signal)).rejects.toThrow();
  expect(execute).not.toHaveBeenCalled();
});

it("runs the real worker against a fake public SDK with SSE, phase events, and no raw thought forwarding", async () => {
  const { root } = await fixture();
  const sdk = path.join(root, "sdk.mjs");
  await fs.writeFile(sdk, `export class ModelRuntime {
    static async create(){ return new ModelRuntime(); }
    getModel(){return {provider:'openai-codex',id:'fixture',api:'openai-codex-responses'};}
    hasConfiguredAuth(){return true;}
    async *streamSimple(model,context,options){
      if(options.transport!=='sse'||options.reasoning!=='medium') throw Error('wrong options');
      yield {type:'start'}; yield {type:'thinking_delta',delta:'private thought'};
      yield {type:'text_delta',delta:'4'};
      yield {type:'done',reason:'stop',message:{provider:model.provider,model:model.id,role:'assistant',content:[{type:'text',text:'4'}],usage:{input:1,output:1}}};
    }
  }`);
  const rootDir = process.cwd(); let output = "";
  for await (const event of runPiProcess({ command: process.execPath, args: ["--import", "tsx", path.join(rootDir, "desktop/electron/pi-model-worker.ts"), sdk], cwd: rootDir, environment: { ...process.env, ZHIXING_ALLOW_LIVE_PROVIDER: "1" }, input: JSON.stringify({ version: 1, selection: { provider: "openai-codex", model: "fixture", thinking: "medium" }, prompt: "问", transport: "sse" }) }, AbortSignal.timeout(5000))) if (event.type === "stdout") output += event.data.toString();
  const events = output.trim().split("\n").map((line) => JSON.parse(line));
  expect(events.at(-1)).toEqual({ type: "done" });
  expect(events.some((event) => event.type === "timing" && event.timing.transport === "sse")).toBe(true);
  expect(events.filter((event) => event.type === "progress").map((event) => event.phase)).toEqual(expect.arrayContaining(["requesting", "waiting", "responding", "finishing"]));
  expect(output).not.toContain("private thought");
});

it("persists turn timings, displays phase activity, and preserves unknown reasoning usage", async () => {
  const { root } = await fixture();
  const store = new DesktopStore(root); const service = new DesktopService(store, () => ({ async *stream() {
    yield { type: "progress", phase: "waiting" };
    yield { type: "usage", usage: { inputTokens: 1, outputTokens: 1 } };
    yield { type: "timing", timing: { ...timing, transport: "sse", totalMs: 140, processTailMs: 30, selectionMs: 0 } };
    yield { type: "text_delta", text: "4" }; yield { type: "done" };
  } }));
  const session = await service.create();
  await service.send({ sessionId: session.id, provider: "pi-codex", style: "adaptive", text: "问" }); await service.idle();
  const message = (await store.load(session.id)).messages.at(-1)!;
  expect(message.modelTimings).toHaveLength(1);
  expect(message.modelTimings?.[0]?.processTailMs).toBe(30);
  expect(message.usage?.reasoningTokens).toBeUndefined();
  expect(message.activities?.some((item) => item.label.includes("模型"))).toBe(true);
});

it("cancels a pending SSE turn and maps the turn timeout without executing tools", async () => {
  const runner: PiProcessRunner = async function* (_request, signal) {
    yield frame({ type: "progress", phase: "requesting" });
    if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
    signal.throwIfAborted();
  };
  const { client } = await fixture(runner);
  const controller = new AbortController();
  await expect((async () => { for await (const event of client.stream("问", controller.signal)) if (event.phase === "requesting") controller.abort(); })()).rejects.toMatchObject({ name: "AbortError" });
  const timeout = await fixture(runner, { timeoutMs: 20 });
  await expect(collect(timeout.client)).rejects.toThrow("provider_timeout");
});
