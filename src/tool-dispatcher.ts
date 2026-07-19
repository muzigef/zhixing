import { z } from "zod";
import { AgentLoop } from "./agent-loop.js";
import type { TopicId } from "./contracts.js";
import { RunContext } from "./run-context.js";
import { ToolHarness, type ToolRisk } from "./tool-harness.js";

/** Compatibility adapter: every legacy dispatcher tool is registered in the common harness. */
export type Tool = { name: string; run(input: unknown): Promise<unknown>; risk?: ToolRisk; timeoutMs?: number; idempotent?: boolean };

export class ToolDispatcher {
  readonly #harness = new ToolHarness();
  readonly #topicId: TopicId;

  constructor(private readonly loop: AgentLoop, tools: readonly Tool[], private readonly run?: RunContext, topicId?: TopicId) {
    this.#topicId = topicId ?? run?.topicId ?? "agent-development";
    for (const tool of tools) {
      this.#harness.register({
        name: tool.name, input: z.unknown(), risk: tool.risk ?? "read", timeoutMs: tool.timeoutMs ?? 30_000,
        idempotent: tool.idempotent ?? false, execute: async (input) => await tool.run(input),
      });
    }
  }

  async call(name: string, input: unknown): Promise<unknown> {
    const stop = this.loop.tool(name, input);
    if (stop) throw new Error(stop);
    if (this.run && typeof input === "object" && input !== null && "topicId" in input && (input as { topicId?: unknown }).topicId !== this.run.topicId) throw new Error("cross_topic_denied");
    await this.run?.tool(name, "started");
    const result = await this.#harness.execute(name, input, { topicId: this.#topicId, signal: new AbortController().signal, maxRisk: "read" });
    if (!result.ok) {
      await this.run?.tool(name, "failed");
      throw new Error(result.errorCode ?? "tool_failed");
    }
    await this.run?.tool(name, "finished");
    return result.output;
  }
}
