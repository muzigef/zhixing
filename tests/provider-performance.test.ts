import { expect, it } from "vitest";
import { benchmarkProviderPerformance } from "../src/provider-performance.js";
import type { ModelClient } from "../src/model.js";
import type { AgentExecutor } from "../src/agent-executor.js";
import { adapterCapabilities } from "../src/model-capabilities.js";
it("pairs fresh and reused clients, separating a progress event from first visible body", async () => {
  let factories = 0, clock = 0; const clients: number[] = [];
  const result = await benchmarkProviderPerformance({ cycles: 2, signal: new AbortController().signal, now: () => clock, create: () => {
    const id = ++factories;
    const client: ModelClient = { identity: { provider: "demo", model: "fixed", connection: "fixture" }, async prepare() { clock += 3; }, async *stream(_prompt, _signal, options) {
      clients.push(id); expect(options?.tools).toEqual([]); clock += 2; yield { type: "progress", phase: "waiting" }; clock += 7; yield { type: "text_delta", text: " " }; clock += 5; yield { type: "text_delta", text: "4" }; clock += 2; yield { type: "usage", usage: { inputTokens: 10, outputTokens: 1 } }; yield { type: "done" };
    } }; return client;
  } });
  expect(clients).toEqual([1, 1, 2, 2]); expect(result.rows).toHaveLength(4);
  expect(result.rows[0]).toMatchObject({ phase: "fresh_client", prepareMs: 3, firstEventMs: 5, firstBodyMs: 17, totalMs: 19, completed: true });
  expect(result.summary[0]).toMatchObject({ planned: 2, completed: 2, failureRate: 0, firstBody: { p50: 17, p95: 17 } });
  expect(result.interpretation).toContain("远端缓存");
});
it("does not invent first-token or first-event timing for a native completed-message runtime", async () => {
  let clock = 0;
  const client: AgentExecutor = { kind: "agent-executor", identity: { provider: "native-codex", model: "fixture", connection: "native-codex" }, capabilities: adapterCapabilities(false, "unknown"), async prepare() { clock += 2; }, async execute(_request, _signal, onText) { clock += 20; onText?.("4"); return { status: "completed", verification: "unverified", text: "4" }; } };
  const result = await benchmarkProviderPerformance({ cycles: 1, create: () => client, signal: new AbortController().signal, now: () => clock });
  expect(result.rows[0]).toMatchObject({ firstEventMs: null, firstBodyMs: 22, firstTokenMs: null, timingUnit: "completed_message", completed: true, usageKnown: false });
});
it("retains failures and cancellation in the denominator and saves a checkpoint before dispatch", async () => {
  let calls = 0; const controller = new AbortController();
  const client: ModelClient = { async *stream() { calls++; yield { type: "progress", phase: "waiting" }; controller.abort(); throw new Error("private error payload"); } };
  const result = await benchmarkProviderPerformance({ cycles: 2, create: () => client, signal: controller.signal });
  expect(calls).toBe(1); expect(result.rows).toHaveLength(4); expect(result.rows.filter(row => row.requestAttempted)).toHaveLength(1);
  expect(result.summary.every(group => group.completed === 0 && group.firstBody.p50 === null)).toBe(true);
  expect(JSON.stringify(result)).not.toContain("private error payload");
  await expect(benchmarkProviderPerformance({ cycles: 1, create: () => client, signal: new AbortController().signal, checkpoint: async () => { throw new Error("disk_unavailable"); } })).rejects.toThrow("disk_unavailable");
  expect(calls).toBe(1);
});
it("stops the entire benchmark if persisting dispatch intent fails, even if later writes would succeed", async () => {
  let calls = 0, refused = false;
  await expect(benchmarkProviderPerformance({ cycles: 2, create: () => ({ async *stream() { calls++; yield { type: "text_delta", text: "4" }; yield { type: "done" }; } }), signal: new AbortController().signal, checkpoint: async report => {
    if (!refused && report.rows.some(row => row.status === "running")) { refused = true; throw new Error("one_time_write_failure"); }
  } })).rejects.toThrow("one_time_write_failure");
  expect(calls).toBe(0);
});
it("runs the bounded benchmark CLI, records real metadata, and enforces explicit live opt-in", async () => {
  const fs = await import("node:fs/promises"), os = await import("node:os"), path = await import("node:path"), { execFile } = await import("node:child_process"), { promisify } = await import("node:util");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "performance-cli-"));
  try {
    const output = path.join(root, "report.json"), prefix = ["--import", "tsx", "scripts/benchmark-provider-performance.ts"];
    await promisify(execFile)(process.execPath, [...prefix, "--provider=demo", "--cycles=1", `--output=${output}`], { timeout: 10_000 });
    const report = JSON.parse(await fs.readFile(output, "utf8"));
    expect(report).toMatchObject({ syntheticOnly: true, planned: 2, provenance: { codeHash: expect.stringMatching(/^[a-f0-9]{64}$/) } });
    expect(report.rows.every((row: { completed: boolean }) => row.completed)).toBe(true);
    await expect(promisify(execFile)(process.execPath, [...prefix, "--provider=native-codex", `--output=${path.join(root, "forbidden.json")}`], { timeout: 10_000 })).rejects.toMatchObject({ code: 1 });
    await expect(fs.stat(path.join(root, "forbidden.json"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
