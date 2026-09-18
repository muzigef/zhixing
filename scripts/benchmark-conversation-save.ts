import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AgentSessionStore } from "../src/agent-session-store.js";

// Isolated logical I/O counters: OS page-cache effects and physical disk writes are not measured.
const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-save-benchmark-"));
const open = fs.open, writeFile = fs.writeFile;
let counters = { segmentReads: 0, writes: 0, logicalWriteBytes: 0 };
fs.open = async (...args: Parameters<typeof fs.open>) => {
  if (String(args[0]).startsWith(root) && /[/\\][a-f0-9]{64}\.json$/.test(String(args[0]))) counters.segmentReads++;
  return open(...args);
};
fs.writeFile = async (...args: Parameters<typeof fs.writeFile>) => {
  if (String(args[0]).startsWith(root)) { counters.writes++; counters.logicalWriteBytes += Buffer.byteLength(args[1] as string); }
  return writeFile(...args);
};
const quantiles = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return { samples: values.length, p50: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1] };
};
try {
  const results = [];
  for (const count of [250, 2000, 10000, 20000]) {
    const store = new AgentSessionStore(path.join(root, String(count)));
    const session = await store.create();
    session.messages = Array.from({ length: count }, (_, index) => ({ id: randomUUID(), role: index % 2 ? "assistant" as const : "user" as const, text: `Synthetic message ${index}. ` + "retained context ".repeat(12), status: "completed" as const, createdAt: session.createdAt }));
    const coldStarted = performance.now(); await store.save(session); const coldSaveMs = performance.now() - coldStarted;
    // Warm schema/JIT and immutable-segment validation before measured tail updates.
    await store.save(session); await store.save(session);
    const samples = [];
    for (let repetition = 0; repetition < 7; repetition++) {
      session.messages.at(-1)!.text = `Tail revision ${repetition}`;
      counters = { segmentReads: 0, writes: 0, logicalWriteBytes: 0 };
      const cpu = process.cpuUsage(); const start = performance.now(); await store.save(session);
      const wallMs = performance.now() - start, cpuTime = process.cpuUsage(cpu);
      samples.push({ wallMs, cpuMs: (cpuTime.user + cpuTime.system) / 1000, ...counters });
    }
    const restored = await new AgentSessionStore(store.root).load(session.id);
    if (JSON.stringify(restored.messages) !== JSON.stringify(session.messages)) throw new Error("benchmark_restore_mismatch");
    results.push({ messages: count, serializedBytes: Buffer.byteLength(JSON.stringify(session)), coldSaveMs, samples, warmWallMs: quantiles(samples.map(s => s.wallMs)), warmCpuMs: quantiles(samples.map(s => s.cpuMs)) });
  }
  process.stdout.write(JSON.stringify({ version: 1, syntheticOnly: true, platform: `${process.platform}-${process.arch}`, node: process.version, scenario: "single-conversation-tail-update", interpretation: "七次预热后尾部修改；逻辑文件读取/写入次数与字节，不是物理磁盘 I/O、常数复杂度或真实模型速度。", results }, null, 2) + "\n");
} finally { fs.open = open; fs.writeFile = writeFile; await fs.rm(root, { recursive: true, force: true }); }
