import { collectInvocation } from "../src/model-invocation.js";
import { providerRuntime } from "../src/assistant-runtime.js";
import { DeltaBatcher } from "../desktop/renderer/delta-batcher.js";
import type { ContinuableModelClient } from "../src/model.js";

const client: ContinuableModelClient = {
  async *stream() { for (let i = 0; i < 4; i++) yield { type: "tool_call", tool: "read", callId: String(i), input: { i } }; yield { type: "done" }; },
  async *continue() { yield { type: "text_delta", text: "done" }; yield { type: "done" }; },
};
const runs = [];
for (let repetition = 1; repetition <= 5; repetition++) for (const parallel of [false, true]) {
  let active = 0; let peak = 0; const start = performance.now();
  const result = await collectInvocation(providerRuntime("fixture", client), {
    role: "tutor", providerId: "fixture", prompt: "synthetic bounded read benchmark", containsUserMaterials: false, confirmed: false,
    canParallelTool: () => parallel,
    onToolCall: async (_tool, input) => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 40)); active--; return input; },
  }, new AbortController().signal);
  runs.push({ repetition, parallel, elapsedMs: Math.round(performance.now() - start), peak, results: result.toolResults.map(r => r.callId) });
}
let flush: (() => void) | undefined; let updates = 0; let length = 0;
const batch = new DeltaBatcher((_s, _m, text) => { updates++; length += text.length; }, task => { flush = task; return () => {}; });
for (let i = 0; i < 1000; i++) batch.add("fixture", "answer", "中");
flush!(); batch.dispose();
process.stdout.write(JSON.stringify({ generatedAt: new Date().toISOString(), scope: "Synthetic 40ms independent read operations; not provider speed or full renderer timing", runs, coalescing: { inputEvents: 1000, updates, textLength: length } }, null, 2) + "\n");
