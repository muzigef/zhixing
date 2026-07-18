import type { TopicId } from "./contracts.js";
import { AuditLogger } from "./audit.js";
import { RunContext } from "./run-context.js";

/** Keeps the single foreground CLI run cancellable without retaining user input. */
export class RunManager {
  #active: { controller: AbortController; lifecycle: RunContext } | undefined;

  constructor(private readonly audit: AuditLogger) {}

  async run(topicId: TopicId, command: string, action: (signal: AbortSignal, lifecycle: RunContext) => Promise<string>): Promise<string> {
    if (this.#active) throw new Error("run_in_progress");
    const controller = new AbortController();
    const lifecycle = new RunContext(this.audit, topicId, command);
    this.#active = { controller, lifecycle };
    await lifecycle.start();
    try {
      if (controller.signal.aborted) throw new DOMException("cancelled", "AbortError");
      await lifecycle.tool(command, "started");
      const result = await action(controller.signal, lifecycle);
      if (controller.signal.aborted) throw new DOMException("cancelled", "AbortError");
      await lifecycle.tool(command, "finished");
      await lifecycle.finish("ok");
      return result;
    } catch (error) {
      await lifecycle.tool(command, "failed");
      if (controller.signal.aborted || error instanceof DOMException && error.name === "AbortError") await lifecycle.cancel();
      else await lifecycle.fail(error instanceof Error ? error.message : "unknown_error");
      throw error;
    } finally { this.#active = undefined; }
  }

  async cancel(): Promise<boolean> {
    const active = this.#active;
    if (!active) return false;
    active.controller.abort();
    return true;
  }
}
