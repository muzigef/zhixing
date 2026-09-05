import { expect, it } from "vitest";
import { summarizePerformance } from "../desktop/core/diagnostics.js";
import { checkRelease } from "../desktop/core/updates.js";

it("separates providers and failures, and never includes message content in diagnostics", () => {
  const samples = [100, 200, 300, 400].map((firstTokenMs) => ({ role: "assistant" as const, status: "completed" as const, provider: "pi-codex" as const, firstTokenMs, durationMs: firstTokenMs * 2, text: "private message", id: crypto.randomUUID(), createdAt: new Date().toISOString() }));
  const result = summarizePerformance([...samples, { ...samples[0]!, provider: "deepseek-api", status: "failed" }]);
  expect(result[0]).toMatchObject({ provider: "pi-codex", completed: 4, firstTokenP50: 200, firstTokenP95: 400 });
  expect(result[1]).toMatchObject({ provider: "deepseek-api", failed: 1, completed: 0 });
  expect(JSON.stringify(result)).not.toContain("private");
});
it("validates stable release versions, rejects off-site links, and handles no public release", async () => {
  const response = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
  expect(await checkRelease("0.3.0", response({ tag_name: "v0.4.0", html_url: "https://github.com/muzigef/zhixing/releases/tag/v0.4.0", draft: false, prerelease: false }))).toMatchObject({ available: true, version: "0.4.0" });
  await expect(checkRelease("0.3.0", response({ tag_name: "v0.4.0", html_url: "https://example.com/evil", draft: false, prerelease: false }))).rejects.toThrow("release_invalid");
  expect(await checkRelease("0.3.0", response({}, 404))).toMatchObject({ available: false });
});
it("separates model and reasoning profiles and reports only observed token usage", () => {
  const base = { role: "assistant" as const, status: "completed" as const, provider: "deepseek-api" as const, text: "private", id: crypto.randomUUID(), createdAt: new Date().toISOString(), durationMs: 2000, firstTokenMs: 100 };
  const result = summarizePerformance([{ ...base, model: "fixture-a", reasoning: "quick", usage: { inputTokens: 12, outputTokens: 8 } }, { ...base, id: crypto.randomUUID(), model: "fixture-a", reasoning: "deep", firstTokenMs: 400 }]);
  expect(result[1]?.variants).toHaveLength(2);
  expect(result[1]?.variants[0]).toMatchObject({ model: "fixture-a", reasoning: "quick", inputTokens: 12, outputTokens: 8 });
  expect(JSON.stringify(result)).not.toContain("private");
});
