/** Synthetic live diagnostic; does not change production worker or Pi settings. */
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { StringDecoder } from "node:string_decoder";
import { PiApplicationClient } from "../src/pi-application-client.js";
import { runPiProcess, type PiProcessRunner } from "../src/pi-client.js";
import { LearningApplication } from "../src/learning-application.js";
import { DesktopService } from "../desktop/core/service.js";
import { DesktopStore } from "../desktop/core/store.js";
import { resolvePackagedPiSdk } from "../desktop/core/pi-runner.js";
import type { ReasoningProfile } from "../src/model.js";

if (!process.argv.includes("--live")) throw new Error("explicit_live_flag_required");
if (process.env.ZHIXING_ALLOW_LIVE_PROVIDER === "0") throw new Error("live_provider_disabled");
const root = process.cwd();
const outputArgument = process.argv.find((arg) => arg.startsWith("--output="))?.slice(9);
if (!outputArgument) throw new Error("explicit_output_required");
const output = path.resolve(outputArgument);
const repetitions = Number(process.argv.find((arg) => arg.startsWith("--repetitions="))?.slice(14) ?? 1);
if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 3) throw new Error("repetitions_invalid");
const selected = process.argv.find((arg) => arg.startsWith("--cases="))?.slice(8).split(",");
const cases: { id: string; tool: boolean; reasoning: ReasoningProfile; transport: "auto" | "sse" }[] = [
  { id: "text-balanced-auto", tool: false, reasoning: "balanced", transport: "auto" },
  { id: "text-quick-auto", tool: false, reasoning: "quick", transport: "auto" },
  { id: "tool-balanced-auto", tool: true, reasoning: "balanced", transport: "auto" },
  { id: "tool-quick-auto", tool: true, reasoning: "quick", transport: "auto" },
  { id: "text-balanced-sse", tool: false, reasoning: "balanced", transport: "sse" },
  { id: "tool-balanced-sse", tool: true, reasoning: "balanced", transport: "sse" },
];
if (selected?.some((id) => !cases.some((task) => task.id === id))) throw new Error("case_invalid");
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-pi-latency-"));
type Stamp = { at: number; type: string; [key: string]: unknown };
type Turn = { start: number; events: Stamp[]; wire: Stamp[]; inputChars: number; toolCount: number };
let app: LearningApplication | undefined;
const report: { version: number; syntheticOnly: boolean; startedAt: string; node: string; fixture?: unknown; workerSha256?: string; selection?: unknown; results: unknown[] } = { version: 1, syntheticOnly: true, startedAt: new Date().toISOString(), node: process.version, results: [] };
const save = async () => { await fs.mkdir(path.dirname(output), { recursive: true }); await fs.writeFile(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 }); };
try {
  app = await LearningApplication.open(path.join(temporary, "workspace"), root);
  // RAG has prerequisites: a fresh workspace deliberately has no active day.
  const fixture = await app.overview("rag");
  if (fixture.days.length || fixture.progress !== "rag：尚未开始") throw new Error("synthetic_fixture_mismatch");
  report.fixture = { topicId: "rag", progress: fixture.progress, activeDay: null };
  const originalWorker = path.join(root, "desktop/build/runtime/pi-model-worker.mjs");
  const workerSource = await fs.readFile(originalWorker, "utf8");
  report.workerSha256 = createHash("sha256").update(workerSource).digest("hex");
  const sdk = await resolvePackagedPiSdk(path.join(root, "desktop"));
  let activeTools: Stamp[] = [];
  const nativeTools = app.tools.bind(app);
  app.tools = (...args: Parameters<LearningApplication["tools"]>) => {
    const result = nativeTools(...args);
    const nativeExecute = result.harness.execute.bind(result.harness);
    result.harness.execute = async (...call: Parameters<typeof nativeExecute>) => {
      activeTools.push({ at: Date.now(), type: "tool_start", tool: call[0] });
      try { return await nativeExecute(...call); }
      finally { activeTools.push({ at: Date.now(), type: "tool_end", tool: call[0] }); }
    };
    return result;
  };
  for (let repetition = 1; repetition <= repetitions; repetition++) for (const task of cases.filter((item) => !selected || selected.includes(item.id))) {
    const turns: Turn[] = [];
    activeTools = [];
    const runner: PiProcessRunner = async function* (request, signal) {
      const start = Date.now();
      const input = JSON.parse(request.input);
      const turn: Turn = { start, events: [], wire: [], inputChars: request.input.length, toolCount: input.options?.tools?.length ?? 0 };
      turns.push(turn);
      const trace = path.join(temporary, `trace-${repetition}-${task.id}-${turns.length}.jsonl`);
      const decoder = new StringDecoder("utf8"); let pending = "";
      const seen = new Set<string>();
      try {
        for await (const event of runPiProcess({ ...request, args: ["--import", path.join(root, "scripts/pi-latency-preload.mjs"), ...request.args], environment: { ...request.environment, ZHIXING_PI_LATENCY_TRACE: trace } }, signal)) {
          if (event.type === "exit") turn.events.push({ at: Date.now(), type: "process_exit", code: event.code });
          else {
            pending += decoder.write(event.data);
            for (;;) {
              const newline = pending.indexOf("\n"); if (newline < 0) break;
              const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
              if (!line.trim()) continue;
              const value = JSON.parse(line);
              if (["text_delta", "tool_call", "usage", "done", "error"].includes(value.type) && !seen.has(value.type)) {
                seen.add(value.type); turn.events.push({ at: Date.now(), type: `worker_${value.type}`, ...(value.type === "usage" ? { usage: value.usage } : {}) });
              }
            }
          }
          yield event;
        }
      } finally {
        const text = await fs.readFile(trace, "utf8").catch(() => "");
        turn.wire = text.trim() ? text.trim().split("\n").map((line) => JSON.parse(line)) : [];
      }
    };
    const pi = new PiApplicationClient({ projectDir: root, executable: process.execPath, worker: originalWorker, sdk, runner, transport: task.transport });
    report.selection ??= await pi.selection();
    const store = new DesktopStore(path.join(temporary, `chats-${repetition}-${task.id}`));
    const service = new DesktopService(store, () => pi, app);
    const session = await service.create();
    if (task.tool) { session.topicId = "rag"; session.workspaceId = app.summary().id; session.contextAllowed = true; await store.save(session); }
    const start = Date.now();
    await service.send({ sessionId: session.id, text: task.tool ? "请实际调用 learning_progress 工具，然后用一句话告诉我当前学习日及状态。" : "2+2 等于几？只回复一个数字。", provider: "pi-codex", style: "adaptive", reasoning: task.reasoning });
    await service.idle();
    const message = (await store.load(session.id)).messages.at(-1)!;
    const result = { ...task, repetition, start, status: message.status, text: message.text, error: message.error, durationMs: message.durationMs, firstTokenMs: message.firstTokenMs, timings: message.timings, modelTimings: message.modelTimings, usage: message.usage, tools: activeTools, turns };
    report.results.push(result); await save();
    console.log(JSON.stringify({ id: task.id, repetition, status: message.status, durationMs: message.durationMs, firstTokenMs: message.firstTokenMs, turns: turns.length, toolMs: activeTools.length === 2 ? activeTools[1]!.at - activeTools[0]!.at : undefined, tails: turns.map((turn) => { const done = turn.events.find((item) => item.type === "worker_done"); const end = turn.events.find((item) => item.type === "process_exit"); return done && end ? end.at - done.at : null; }) }));
    if (message.status !== "completed") throw new Error("live_probe_failed_see_safe_report");
  }
} finally { await save(); app?.close(); await fs.rm(temporary, { recursive: true, force: true }); }
