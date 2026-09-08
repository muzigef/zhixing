import { expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod/v4";
import { LearningApplication } from "../src/learning-application.js";
import { ToolHarness } from "../src/tool-harness.js";
import { ToolResultStore } from "../src/tool-result-store.js";

it("retrieves a large result after restarting the harness, with task/topic isolation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-result-")); const app = await LearningApplication.open(root, process.cwd());
  try {
    const taskId = randomUUID(); const harness = new ToolHarness(); harness.useResults(new ToolResultStore(app.database, taskId));
    const raw = { status: "failed", exitCode: 1, stdout: "甲".repeat(16000) };
    harness.register({ name: "large", input: z.object({}), risk: "read", idempotent: true, timeoutMs: 1000, execute: async () => raw });
    const context = { topicId: "rag", signal: new AbortController().signal };
    const result = await harness.execute("large", {}, context); const output = result.output as { resultId: string };
    expect(result).toMatchObject({ ok: true, output: { truncated: true, status: "failed", exitCode: 1, resultId: expect.any(String) } });
    const resumed = new ToolHarness(); resumed.useResults(new ToolResultStore(app.database, taskId));
    let offset: number | null = 0; let serialized = "";
    while (offset !== null) { const page = await resumed.execute("read_tool_result", { resultId: output.resultId, offset }, context); expect(page.ok).toBe(true); const data = page.output as { content: string; nextOffset: number | null }; serialized += data.content; offset = data.nextOffset; }
    expect(JSON.parse(serialized)).toEqual(raw);
    expect((await resumed.execute("read_tool_result", { resultId: output.resultId }, { ...context, topicId: "tool-calling" })).ok).toBe(false);
    const other = new ToolHarness(); other.useResults(new ToolResultStore(app.database, randomUUID()));
    expect((await other.execute("read_tool_result", { resultId: output.resultId }, context)).ok).toBe(false);
  } finally { app.close(); await fs.rm(root, { recursive: true, force: true }); }
});
