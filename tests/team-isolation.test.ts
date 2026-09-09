import { describe, expect, it } from "vitest";
import { z } from "zod/v4";
import { ToolHarness } from "../src/tool-harness.js";
import { onDemandTools } from "../src/agent-efficiency.js";
describe("member tool boundary", () => {
  it("restricts both discovery and dispatch, including tools registered lazily after restriction", async () => {
    const harness = new ToolHarness(); const executed: string[] = [];
    const register = (name: string, risk: "read" | "write") => harness.register({ name, risk, description: name, input: z.object({}), idempotent: true, timeoutMs: 100, execute: async () => { executed.push(name); } });
    register("plan_task", "read"); register("project_read", "read"); register("project_edit", "write");
    harness.restrict(name => name !== "plan_task" && harness.risk(name) === "read");
    const catalog = onDemandTools({ harness, definitions: harness.definitions() }, [], false, { categories: ["external"], prepare: async () => { register("mcp_read", "read"); register("mcp_write", "write"); } });
    const context = { topicId: "rag", signal: new AbortController().signal, maxRisk: "write" as const };
    await harness.execute("discover_tools", { category: "external" }, context);
    expect(catalog.advertised().map(tool => tool.name)).toContain("mcp_read");
    expect(catalog.advertised().map(tool => tool.name)).not.toContain("mcp_write");
    for (const name of ["plan_task", "project_edit", "mcp_write"]) expect(await harness.execute(name, {}, context)).toMatchObject({ ok: false, errorCode: "tool_policy_denied" });
    expect(executed).toEqual([]);
  });
});
