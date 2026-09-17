import fs from "node:fs/promises";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runPythonTests } from "../src/python-runner.js";

const mocks = vi.hoisted(() => ({ exec: vi.fn(), run: vi.fn() }));
vi.mock("../src/process-gateway.js", async () => {
  const { promisify } = await import("node:util");
  Object.defineProperty(mocks.exec, promisify.custom, { value: (...args: unknown[]) => new Promise((resolve, reject) => {
    mocks.exec(...args, (error: Error | null, stdout: string, stderr: string) => error ? reject(error) : resolve({ stdout, stderr }));
  }) });
  return { hostProcess: () => ({ execFile: mocks.exec }) };
});
vi.mock("../src/local-sandbox.js", () => ({ LocalSandbox: class { run = mocks.run; } }));
const completed = { status: "completed", exitCode: 0, stdout: "", stderr: "" };
const runtime = JSON.stringify({ executable: "/usr/bin/python3", prefix: "/usr" });
let now = 1000;
beforeEach(() => {
  vi.stubGlobal("process", { ...process, platform: "linux" });
  now = 1000; vi.spyOn(Date, "now").mockImplementation(() => now);
  vi.spyOn(fs, "realpath").mockImplementation(async file => String(file));
  mocks.exec.mockReset(); mocks.run.mockReset().mockResolvedValue(completed);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("allows a cold interpreter probe within the caller deadline and gives execution only the remainder", async () => {
  mocks.exec.mockImplementation((_command, _args, options, callback) => {
    now += 3000;
    callback(options.timeout < 3000 ? Object.assign(new Error("synthetic timeout"), { killed: true }) : null, runtime, "");
  });
  expect(await runPythonTests({}, [], new AbortController().signal, 10_000)).toEqual(completed);
  expect(mocks.exec).toHaveBeenCalledTimes(1);
  expect(mocks.run).toHaveBeenCalledWith("/usr/bin/python3", expect.any(Array), expect.objectContaining({ timeoutMs: 7000 }));
});

it("reports discovery deadline exhaustion as timeout and never dispatches another probe or task", async () => {
  mocks.exec.mockImplementation((_command, _args, _options, callback) => {
    now += 10_000; callback(Object.assign(new Error("synthetic timeout"), { killed: true }), "", "");
  });
  expect(await runPythonTests({}, [], new AbortController().signal, 10_000)).toMatchObject({ status: "timed_out" });
  expect(mocks.exec).toHaveBeenCalledTimes(1); expect(mocks.run).not.toHaveBeenCalled();
});

it("does not start execution if a successful probe returns after the deadline", async () => {
  mocks.exec.mockImplementation((_command, _args, _options, callback) => { now += 10_001; callback(null, runtime, ""); });
  expect(await runPythonTests({}, [], new AbortController().signal, 10_000)).toMatchObject({ status: "timed_out" });
  expect(mocks.run).not.toHaveBeenCalled();
});

it("keeps missing interpreters distinct from timeout without exposing exception messages", async () => {
  mocks.exec.mockImplementation((_command, _args, _options, callback) => callback(Object.assign(new Error("synthetic private path"), { code: "ENOENT" }), "", ""));
  const result = await runPythonTests({}, [], new AbortController().signal, 10_000);
  expect(result.status).toBe("unavailable"); expect(result.stderr).toContain("inspect:ENOENT");
  expect(result.stderr).not.toContain("synthetic private path"); expect(mocks.run).not.toHaveBeenCalled();
});

it("preserves caller cancellation instead of reporting a missing interpreter", async () => {
  const controller = new AbortController();
  mocks.exec.mockImplementation((_command, _args, _options, callback) => { controller.abort(); callback(new Error("aborted"), "", ""); });
  await expect(runPythonTests({}, [], controller.signal, 10_000)).rejects.toMatchObject({ name: "AbortError" });
  expect(mocks.run).not.toHaveBeenCalled();
});

it("cancels sandbox preparation at the same task deadline and waits for cleanup", async () => {
  mocks.exec.mockImplementation((_command, _args, _options, callback) => callback(null, runtime, ""));
  let cleaned = false;
  mocks.run.mockImplementation((_command, _args, options) => new Promise(resolve => {
    options.signal.addEventListener("abort", () => { cleaned = true; resolve({ ...completed, status: "cancelled" }); }, { once: true });
  }));
  expect(await runPythonTests({}, [], new AbortController().signal, 30)).toMatchObject({ status: "timed_out" });
  expect(cleaned).toBe(true);
});
