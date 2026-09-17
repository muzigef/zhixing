import { expect, it } from "vitest";
import { createSandboxPolicy, validateSandboxInputs, assertSandboxCapabilities } from "../src/sandbox-policy.js";

it("uses one immutable deny-by-default policy for code and restricted MCP", () => {
  const policy = createSandboxPolicy();
  expect(policy).toMatchObject({ version: 1, network: "deny", maxProcesses: 1, timeoutMs: 5000, memoryBytes: 512 * 1024 * 1024 });
  expect(Object.isFrozen(policy)).toBe(true);
  for (const override of [{ timeoutMs: NaN }, { timeoutMs: 0 }, { memoryBytes: Infinity }, { network: "allow" }, { maxProcesses: 2 }, { unknown: true }]) {
    expect(() => createSandboxPolicy(override as never)).toThrow();
  }
});

it("validates inputs before selecting any OS backend", () => {
  const policy = createSandboxPolicy({ inputBytes: 64 });
  for (const name of ["../escape", "/escape", "a//b", "a/./b", "a\\b", "NUL.txt", "a/CON", "a."]) {
    expect(() => validateSandboxInputs({ [name]: "x" }, policy)).toThrow("sandbox_file_denied");
  }
  expect(() => validateSandboxInputs({ "a.txt": "中".repeat(22) }, policy)).toThrow("sandbox_input_limit");
  expect(() => validateSandboxInputs({ "a.txt": "one", "A.txt": "two" }, policy)).toThrow("sandbox_file_denied");
  expect(() => validateSandboxInputs({ a: "file", "a/b": "nested" }, policy)).toThrow("sandbox_file_denied");
});

it("fails closed when the requested guarantee is not provided by a backend", () => {
  const policy = createSandboxPolicy({ requireHardMemoryLimit: true });
  expect(() => assertSandboxCapabilities(policy, { memory: "monitored", interactive: true }, false)).toThrow("sandbox_capability_unavailable");
  expect(() => assertSandboxCapabilities(policy, { memory: "hard", interactive: false }, true)).toThrow("sandbox_capability_unavailable");
  expect(() => assertSandboxCapabilities(policy, { memory: "hard", interactive: false }, false)).not.toThrow();
});
