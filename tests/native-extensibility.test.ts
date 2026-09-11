import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { NativeAgentExecutor, nativeBackend, nativeEnvironment, type NativeRunner } from "../src/native-agent.js";
import { nativeRuntimeCatalog, nativeProviderSchema } from "../src/native-runtime-catalog.js";
import type { NativeRuntimeAdapter } from "../src/native-runtime-contract.js";
import { providerSchema } from "../src/agent-provider.js";
import { providerSchema as desktopProviderSchema } from "../desktop/core/contracts.js";
import { AgentService } from "../src/agent-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";

const request = { messages: [{ role: "system" as const, content: "合成教学规则" }, { role: "user" as const, content: "合成问题" }], maxOutputChars: 1000 };
const signal = () => new AbortController().signal;
function futureAdapter(text = "合成未来运行时回答"): NativeRuntimeAdapter {
  return { model: () => "fixture-pinned-model", async probe() { return { available: true, reason: "synthetic" }; },
    async execute(command, _runner, input, _model, _signal, onText) {
      expect(await fs.readFile(path.join(command.cwd, "instructions.txt"), "utf8")).toContain("教学");
      expect((await fs.stat(path.join(command.cwd, "instructions.txt"))).mode & 0o777).toBe(0o600);
      expect(input.messages.some(m => m.role === "user")).toBe(true);
      expect(command.environment).not.toHaveProperty("OPENAI_API_KEY");
      onText?.(text); return { text, status: "completed", verification: "unverified" };
    } };
}
const runner: NativeRunner = async (_command, _signal, line) => { line("synthetic help"); };
it("derives both entry-point provider validation and discovery from one reviewed runtime catalog", () => {
  for (const entry of nativeRuntimeCatalog) {
    expect(nativeProviderSchema.parse(entry.provider)).toBe(entry.provider);
    expect(providerSchema.parse(entry.provider)).toBe(entry.provider);
    expect(desktopProviderSchema.parse(entry.provider)).toBe(entry.provider);
    expect(nativeBackend(entry.provider)?.vendor).toBe(entry.vendor);
  }
  expect(nativeProviderSchema.safeParse("native-unregistered").success).toBe(false);
  expect(nativeBackend("native-unregistered")).toBeUndefined();
});
it("runs a newly supplied trusted adapter through the unchanged executor and shared conversation service", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "native-extension-"));
  const driver = futureAdapter(); const execute = vi.spyOn(driver, "execute");
  const executor = new NativeAgentExecutor("gemini", { OPENAI_API_KEY: "fixture-not-inherited" }, runner, "/synthetic/future", undefined, driver);
  const store = new AgentSessionStore(root), service = new AgentService(store, () => executor);
  try {
    expect(executor.identity).toMatchObject({ provider: "native-gemini", model: "fixture-pinned-model" });
    const session = await service.create();
    await service.invoke({ sessionId: session.id, provider: "native-gemini", style: "adaptive", text: "第一次合成问题" });
    await service.pauseMaintenance();
    await service.invoke({ sessionId: session.id, provider: "native-gemini", style: "adaptive", text: "第二次合成问题" });
    expect((await store.load(session.id)).messages.at(-1)?.status).toBe("completed");
    expect(execute.mock.calls.at(-1)![2].messages.some(m => m.content.includes("第一次合成问题"))).toBe(true);
    for (const call of execute.mock.calls) await expect(fs.stat(call[0].cwd)).rejects.toMatchObject({ code: "ENOENT" });
  } finally { service.stop(); await service.idle(); await service.pauseMaintenance(); await fs.rm(root, { recursive: true, force: true }); }
});
it.each(["", "x".repeat(1001)])("enforces shared output bounds for future adapters", async text => {
  const executor = new NativeAgentExecutor("gemini", {}, runner, "/synthetic/future", undefined, futureAdapter(text));
  await expect(executor.execute(request, signal())).rejects.toThrow(/provider_(incomplete|output_limit)/);
});
it("rejects a future adapter whose streamed and final answer disagree", async () => {
  const driver = futureAdapter(); driver.execute = async (_command, _runner, _request, _model, _signal, onText) => { onText?.("first"); return { text: "different", status: "completed", verification: "unverified" }; };
  await expect(new NativeAgentExecutor("gemini", {}, runner, "/synthetic/future", undefined, driver).execute(request, signal())).rejects.toThrow("provider_protocol_error");
});
it("keeps unimplemented runtimes unavailable and the offline switch ahead of any adapter I/O", async () => {
  const probeRunner = vi.fn(runner);
  await expect(new NativeAgentExecutor("gemini", {}, probeRunner).execute(request, signal())).rejects.toThrow("native_isolation_unavailable");
  expect(probeRunner.mock.calls.every(call => call[0].args.includes("--help"))).toBe(true);
  probeRunner.mockClear();
  await expect(new NativeAgentExecutor("gemini", { ZHIXING_ALLOW_LIVE_PROVIDER: "0" }, probeRunner, "/synthetic/future", undefined, futureAdapter()).execute(request, signal())).rejects.toThrow("live_provider_disabled");
  expect(probeRunner).not.toHaveBeenCalled();
  expect(nativeEnvironment({ CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "0" })).toEqual({});
});
