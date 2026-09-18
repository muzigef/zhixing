import { expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentService } from "../src/agent-service.js";
import { AgentSessionStore } from "../src/agent-session-store.js";
it("timestamps the first non-whitespace body through the shared application without dropping earlier whitespace", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "first-body-")); let clock = 1000;
  const spy = vi.spyOn(Date, "now").mockImplementation(() => clock);
  const store = new AgentSessionStore(root), service = new AgentService(store, () => ({ async *stream() { yield { type: "text_delta", text: " \n" }; clock += 30; yield { type: "text_delta", text: "4" }; yield { type: "done" }; } }));
  try {
    const session = await service.create(); await service.invoke({ sessionId: session.id, provider: "demo", mode: "chat", purpose: "answer", style: "concise", text: "计算2+2，只返回数字。" });
    const answer = (await store.load(session.id)).messages.at(-1)!;
    expect(answer.firstTokenMs).toBe(30); expect(answer.text).toBe(" \n4");
  } finally { service.stop(); await service.idle(); await service.pauseMaintenance(); spy.mockRestore(); await fs.rm(root, { recursive: true, force: true }); }
});
