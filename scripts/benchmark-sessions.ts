import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AgentSessionStore } from "../src/agent-session-store.js";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-scale-measurement-"));
try {
  await fs.mkdir(path.join(root, "conversations")); let bytes = 0;
  for (let index = 0; index < 500; index++) {
    const id = randomUUID(); const at = new Date(1_700_000_000_000 + index).toISOString();
    const session = { version: 4, id, title: `Synthetic history ${index}`, createdAt: at, updatedAt: at, customTitle: false, messages: Array.from({ length: 40 }, (_, n) => ({ id: randomUUID(), role: n % 2 ? "assistant" : "user", text: "Synthetic retained conversation. ".repeat(40), status: "completed", createdAt: at })) };
    const text = JSON.stringify(session); bytes += Buffer.byteLength(text); await fs.writeFile(path.join(root, "conversations", `${id}.json`), text);
  }
  class MeasuredStore extends AgentSessionStore { reads = 0; override async load(id: string) { this.reads++; return super.load(id); } }
  const cold = new MeasuredStore(root); const start = performance.now(); const first = await cold.page(); const coldMs = performance.now() - start;
  const warm = new MeasuredStore(root); const times: number[] = [];
  for (let run = 0; run < 5; run++) { const start = performance.now(); await warm.page(); times.push(performance.now() - start); }
  const ordered = [...times].sort((a, b) => a - b);
  process.stdout.write(JSON.stringify({ syntheticOnly: true, platform: `${process.platform}-${process.arch}`, node: process.version, sessions: 500, messages: 20_000, conversationBytes: bytes, returnedPerPage: first.sessions.length, coldMs, coldConversationReads: cold.reads, warmMs: times, warmMedianMs: ordered[2], warmConversationReads: warm.reads, indexBytes: (await fs.stat(path.join(root, "session-index.json"))).size }, null, 2) + "\n");
} finally { await fs.rm(root, { recursive: true, force: true }); }
