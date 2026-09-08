import { expect, it, vi } from "vitest";
import { executionSupport, assertExecutionSupport } from "../src/platform-support.js";
import { checkRelease } from "../desktop/core/updates.js";
it("distinguishes a missing sandbox from an unsupported platform without promising host validation", () => {
  expect(executionSupport("darwin", true)).toMatchObject({ available: true, verification: "runtime_result_required" });
  expect(executionSupport("darwin", false)).toMatchObject({ available: false, reason: "sandbox_missing" });
  for (const platform of ["win32", "linux"] as const) {
    expect(executionSupport(platform, true)).toMatchObject({ available: false, reason: "platform_unsupported" });
    expect(() => assertExecutionSupport(platform, true)).toThrow("platform_execution_unavailable");
  }
});
it("rejects invalid installed versions before checking a release and identifies a build newer than public releases", async () => {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ tag_name: "v0.7.0", html_url: "https://github.com/muzigef/zhixing/releases/tag/v0.7.0", draft: false, prerelease: false })));
  await expect(checkRelease("invalid", fetcher)).rejects.toThrow("release_current_version_invalid"); expect(fetcher).not.toHaveBeenCalled();
  expect(await checkRelease("0.8.0", fetcher)).toMatchObject({ available: false, message: expect.stringContaining("高于") });
});
