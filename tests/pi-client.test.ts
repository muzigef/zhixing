import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PiCodexClient, readPiModelSelection, type PiProcessRunner, type PiProcessRequest } from "../src/pi-client.js";
import type { ModelEvent } from "../src/model.js";
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-pi-")); roots.push(root);
  const projectDir = path.join(root, "project"); const agentDir = path.join(root, "pi");
  await fs.mkdir(path.join(projectDir, ".pi"), { recursive: true }); await fs.mkdir(agentDir);
  await fs.writeFile(path.join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "openai-codex", defaultModel: "fixture-codex", defaultThinkingLevel: "medium" }));
  return { projectDir, agentDir, environment: { PI_CODING_AGENT_DIR: agentDir, ZHIXING_ALLOW_LIVE_PROVIDER: "1" } };
}
const end = (text: string, stopReason = "stop") => ({ type: "message_end", message: { role: "assistant", provider: "openai-codex", model: "fixture-codex", stopReason, content: [{ type: "text", text }] } });
const delta = (text: string) => ({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: text } });
const done = { type: "agent_end", messages: [] };
const runner = (events: unknown[], exit = 0): PiProcessRunner => async function* () { yield { type: "stdout", data: Buffer.from(events.map((event) => JSON.stringify(event)).join("\n")) }; yield { type: "exit", code: exit }; };
async function collect(client: PiCodexClient, signal = new AbortController().signal) { const events: ModelEvent[] = []; for await (const event of client.stream("普通问题 @not-a-file", signal)) events.push(event); return events; }
describe("Pi configured Codex provider", () => {
  it("inherits non-secret global settings with project overrides and reloads changes", async () => {
    const fixture = await setup();
    expect(await readPiModelSelection(fixture.projectDir, fixture.environment)).toEqual({ provider: "openai-codex", model: "fixture-codex", thinking: "medium" });
    await fs.writeFile(path.join(fixture.projectDir, ".pi", "settings.json"), JSON.stringify({ defaultThinkingLevel: "low" }));
    expect((await readPiModelSelection(fixture.projectDir, fixture.environment)).thinking).toBe("low");
    await fs.writeFile(path.join(fixture.agentDir, "settings.json"), JSON.stringify({ defaultProvider: "other-provider", defaultModel: "other-model" }));
    await expect(readPiModelSelection(fixture.projectDir, fixture.environment)).rejects.toThrow("pi_configuration_required");
  });
  it("uses the safe launcher, exact Pi selection, stdin and an empty tool allowlist", async () => {
    const fixture = await setup(); let request: PiProcessRequest | undefined;
    const run: PiProcessRunner = async function* (value) { request = value; yield* runner([delta("你好"), end("你好"), done])(value, new AbortController().signal); };
    const client = new PiCodexClient({ ...fixture, runner: run });
    expect(await collect(client)).toEqual([{ type: "text_delta", text: "你好" }, { type: "done" }]);
    expect(request?.command).toBe("bash");
    expect(request?.args[0]).toBe(path.join(fixture.projectDir, "scripts", "pi-safe.sh"));
    expect(request?.args).toEqual(expect.arrayContaining(["--mode", "json", "--no-session", "--no-tools", "--provider", "openai-codex", "--model", "fixture-codex", "--thinking", "medium"]));
    expect(request?.args[(request?.args.indexOf("--tools") ?? -1) + 1]).toBe("");
    expect(request?.args.join(" ")).not.toContain("普通问题");
    expect(request?.args).not.toEqual(expect.arrayContaining(["--no-context-files", "--api-key"]));
    expect(request?.input).toContain("普通问题 @not-a-file");
  });
  it("decodes split UTF-8, suppresses thinking and does not repeat cumulative message snapshots", async () => {
    const fixture = await setup();
    const events = [{ type: "session" }, { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "private reasoning" } }, delta("中"), delta("文"), end("中文"), done];
    const run: PiProcessRunner = async function* () { for (const byte of Buffer.from(events.map((event) => JSON.stringify(event)).join("\n"))) yield { type: "stdout", data: Buffer.from([byte]) }; yield { type: "exit", code: 0 }; };
    expect(await collect(new PiCodexClient({ ...fixture, runner: run }))).toEqual([{ type: "text_delta", text: "中" }, { type: "text_delta", text: "文" }, { type: "done" }]);
  });
  it("supports a completed message when no deltas arrive", async () => {
    const fixture = await setup(); expect(await collect(new PiCodexClient({ ...fixture, runner: runner([end("完整文本"), done]) }))).toEqual([{ type: "text_delta", text: "完整文本" }, { type: "done" }]);
  });
  it.each(["error", "aborted", "length", "toolUse"])("never reports success for Pi stopReason %s even with exit zero", async (reason) => {
    const fixture = await setup(); await expect(collect(new PiCodexClient({ ...fixture, runner: runner([delta("部分"), end("部分", reason), done]) }))).rejects.toThrow(/provider_(unavailable|incomplete|tools_unsupported)/);
  });
  it("rejects missing completion, mismatched models, tool execution and nonzero exits", async () => {
    const fixture = await setup();
    await expect(collect(new PiCodexClient({ ...fixture, runner: runner([delta("部分")]) }))).rejects.toThrow("provider_incomplete");
    await expect(collect(new PiCodexClient({ ...fixture, runner: runner([{ ...end("错误路由"), message: { ...end("错误路由").message, model: "different-model" } }, done]) }))).rejects.toThrow("provider_model_mismatch");
    await expect(collect(new PiCodexClient({ ...fixture, runner: runner([{ type: "tool_execution_start" }]) }))).rejects.toThrow("provider_tools_unsupported");
    await expect(collect(new PiCodexClient({ ...fixture, runner: runner([end("完整"), done], 1) }))).rejects.toThrow("provider_unavailable");
  });
  it.each(["Failed to extract accountId from token", "No API key for provider: openai-codex"])("identifies unusable Pi Codex authentication: %s", async (errorMessage) => {
    const fixture = await setup();
    const failed = end("", "error");
    const events = [{ ...failed, message: { ...failed.message, errorMessage } }, done];
    await expect(collect(new PiCodexClient({ ...fixture, runner: runner(events) }))).rejects.toThrow("pi_login_required");
  });
  it("rejects malformed JSON and bounded stream overflow", async () => {
    const fixture = await setup();
    const malformed: PiProcessRunner = async function* () { yield { type: "stdout", data: Buffer.from("bad-json\n") }; };
    await expect(collect(new PiCodexClient({ ...fixture, runner: malformed }))).rejects.toThrow("provider_protocol_error");
    const tooLarge: PiProcessRunner = async function* () { yield { type: "stdout", data: Buffer.alloc(1_048_577, 120) }; };
    await expect(collect(new PiCodexClient({ ...fixture, runner: tooLarge }))).rejects.toThrow("provider_output_limit");
  });
  it("enforces local-only and cancellation before spawning", async () => {
    const fixture = await setup(); let called = false;
    const run: PiProcessRunner = async function* () { called = true; yield { type: "exit", code: 0 }; };
    await expect(collect(new PiCodexClient({ ...fixture, environment: { ...fixture.environment, ZHIXING_ALLOW_LIVE_PROVIDER: "0" }, runner: run }))).rejects.toThrow("live_provider_disabled");
    const controller = new AbortController(); controller.abort();
    await expect(collect(new PiCodexClient({ ...fixture, runner: run }), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(called).toBe(false);
  });
  it("times out and closes an unresponsive stream", async () => {
    const fixture = await setup(); let stopped = false;
    const run: PiProcessRunner = async function* (_request, signal) { try { await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true })); yield { type: "exit", code: 1 }; } finally { stopped = true; } };
    await expect(collect(new PiCodexClient({ ...fixture, runner: run, timeoutMs: 50 }))).rejects.toThrow("provider_timeout");
    expect(stopped).toBe(true);
  });
});
