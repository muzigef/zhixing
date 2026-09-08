import { expect, it } from "vitest";
import { z } from "zod/v4";
import { Ajv } from "ajv";
import { createRequire } from "node:module";
const addFormats = createRequire(import.meta.url)("ajv-formats") as (ajv: Ajv) => void;
import { ToolHarness } from "../src/tool-harness.js";
import { taskPlanSchema } from "../src/task-execution.js";

it("derives advertised input from the executable schema, including defaults and bounds", async () => {
  const harness = new ToolHarness();
  harness.register({ name: "bounded", description: "合成工具", input: z.object({ text: z.string().min(2).max(4), offset: z.number().int().min(0).default(0) }).strict(), risk: "read", idempotent: true, timeoutMs: 1000, execute: async input => input });
  const definition = harness.definitions()[0]!; const ajv = new Ajv({ strict: false }); const validate = ajv.compile(definition.inputSchema);
  for (const input of [{ text: "ok" }, { text: "ok", offset: 2 }, { text: "x" }, { text: "12345" }, { text: "ok", offset: -1 }, { text: "ok", extra: true }]) {
    const accepted = (await harness.execute("bounded", input, { topicId: "rag", signal: new AbortController().signal })).ok;
    expect(validate(input), JSON.stringify(input)).toBe(accepted);
  }
  expect(definition.description).toBe("合成工具");
});
it("expresses project/course completion requirements in the same executable plan schema", () => {
  const ajv = new Ajv({ strict: false }); addFormats(ajv);
  const validate = ajv.compile(z.toJSONSchema(taskPlanSchema, { target: "draft-7", io: "input" }));
  const cases = [
    { id: "edit", title: "修改", doneWhen: "project_file_saved", projectId: "a1ad1bac-9b7b-4d67-8f7e-115f3ea0cdb9" },
    { id: "edit", title: "修改", doneWhen: "project_file_saved", projectId: "a1ad1bac-9b7b-4d67-8f7e-115f3ea0cdb9", kind: "implementation" },
    { id: "save", title: "保存", doneWhen: "artifact_saved", kind: "implementation" },
    { id: "save", title: "保存", doneWhen: "artifact_saved" },
    { id: "test", title: "测试", doneWhen: "tests_passed" },
  ];
  expect(cases.map(item => taskPlanSchema.safeParse([item]).success)).toEqual([true, false, true, true, true]);
  for (const item of cases) expect(validate([item])).toBe(taskPlanSchema.safeParse([item]).success);
});
it("bounds large results without dropping their execution status", async () => {
  const harness = new ToolHarness();
  harness.register({ name: "large", description: "large", input: z.object({}), risk: "read", idempotent: true, timeoutMs: 1000, execute: async () => ({ status: "failed", exitCode: 1, stdout: "x".repeat(30000) }) });
  expect(await harness.execute("large", {}, { topicId: "rag", signal: new AbortController().signal })).toMatchObject({ ok: true, output: { truncated: true, status: "failed", exitCode: 1 } });
});
