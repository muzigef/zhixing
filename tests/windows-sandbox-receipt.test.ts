import { expect, it } from "vitest";
import { decodeWindowsSandboxResult } from "../src/windows-sandbox.js";

const fallback = { status: "unavailable" as const, stdout: "", stderr: "Windows AppContainer 沙箱未就绪。", exitCode: null };
it.each(["win32_5_at_134", "ntstatus_C0000022"])("preserves safe native error %s and stage instead of an empty unavailable result", error => {
  const result = decodeWindowsSandboxResult(JSON.stringify({ status: "unavailable", stdoutBase64: "", stderrBase64: "", exitCode: null, error, stage: "create_process" }), fallback);
  expect(result).toMatchObject({ status: "unavailable", exitCode: null });
  expect(result.stderr).toContain(`create_process:${error}`);
});
it("does not expose an arbitrary launcher error message or malformed result", () => {
  const result = decodeWindowsSandboxResult(JSON.stringify({ status: "unavailable", stdoutBase64: "", stderrBase64: "", exitCode: null, error: "private path and environment", stage: "create_process" }), fallback);
  expect(result).toEqual(fallback);
  expect(decodeWindowsSandboxResult("not JSON", fallback)).toEqual(fallback);
});
