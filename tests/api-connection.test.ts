import { expect, it } from "vitest";
import { checkApiConnection } from "../src/api-connection.js";
import type { ModelClient } from "../src/model.js";
it("tests a connection using a bounded synthetic prompt without history or tools", async () => {
  const client: ModelClient = { async *stream(prompt, _signal, options) {
    expect(prompt).toContain("连接测试");
    expect(options).toEqual({ reasoning: "quick", maxOutputTokens: 2048 });
    yield { type: "text_delta", text: "连接正常" };
    yield { type: "usage", usage: { model: "synthetic", inputTokens: 10, outputTokens: 5 } };
    yield { type: "done" };
  } };
  expect(await checkApiConnection(client)).toMatchObject({ model: "synthetic", durationMs: expect.any(Number), firstTokenMs: expect.any(Number) });
});
it("does not mistake tool requests or incomplete output for successful connectivity", async () => {
  for (const type of ["tool_call", "text_delta"] as const) {
    const client: ModelClient = { async *stream() { yield { type, text: "partial", tool: "read", input: {} }; } };
    await expect(checkApiConnection(client)).rejects.toThrow("provider_");
  }
});
