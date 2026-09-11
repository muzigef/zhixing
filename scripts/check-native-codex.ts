import http from "node:http";
import { gunzipSync } from "node:zlib";
import { NativeAgentExecutor, runNativeProcess, type NativeRunner } from "../src/native-agent.js";

const live = process.argv.includes("--live");
const executable = process.env.ZHIXING_CODEX_EXECUTABLE || "codex";
let received = false;
const server = http.createServer((request, response) => {
  const chunks: Buffer[] = [];
  request.on("data", chunk => chunks.push(chunk));
  request.on("end", () => {
    try {
      const bytes = Buffer.concat(chunks);
      const body = JSON.parse((request.headers["content-encoding"] === "gzip" ? gunzipSync(bytes) : bytes).toString());
      const instructionsPresent = JSON.stringify(body).includes("ZHIXING_SYNTHETIC_RULE_7291");
      const noTools = !body.tools || Array.isArray(body.tools) && body.tools.length === 0;
      const noAuthorization = !request.headers.authorization;
      console.log(JSON.stringify({ fixture: true, instructionsPresent, noTools, noAuthorization }));
      if (!instructionsPresent || !noTools || !noAuthorization) throw new Error("native_wire_boundary_failed");
      received = true;
      response.writeHead(200, { "content-type": "text/event-stream" });
      const message = { id: "synthetic-message", type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "4" }] };
      for (const event of [
        { type: "response.created", response: { id: "synthetic-response", status: "in_progress", output: [] } },
        { type: "response.output_item.added", output_index: 0, item: { ...message, status: "in_progress", content: [] } },
        { type: "response.output_text.delta", item_id: message.id, output_index: 0, content_index: 0, delta: "4" },
        { type: "response.output_item.done", output_index: 0, item: message },
        { type: "response.completed", response: { id: "synthetic-response", status: "completed", output: [message], usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } } },
      ]) response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      response.end();
    } catch { response.writeHead(500); response.end(); }
  });
});
try {
  if (!live) await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const fixtureRunner: NativeRunner = async (command, signal, line) => {
    if (command.args[0] === "login") { line("Logged in using ChatGPT"); return; }
    if (command.args[0] !== "exec" || command.args.includes("--help")) return runNativeProcess(command, signal, line);
    const args = command.args.map(arg => arg === 'forced_login_method="chatgpt"' ? 'model_providers.fixture={name="Fixture",wire_api="responses",requires_openai_auth=false,base_url="http://127.0.0.1:' + (typeof address === "object" && address ? address.port : 0) + '"}' : arg === 'model_provider="openai"' ? 'model_provider="fixture"' : arg);
    args.splice(args.length - 1, 0, "-c", "features.enable_request_compression=false");
    return runNativeProcess({ ...command, args }, signal, line);
  };
  const executor = new NativeAgentExecutor("codex", process.env, live ? undefined : fixtureRunner, executable);
  const start = performance.now(); let firstOutputMs: number | undefined;
  const result = await executor.execute({ messages: [{ role: "system", content: "ZHIXING_SYNTHETIC_RULE_7291: 请只返回运算结果，不使用工具。" }, { role: "user", content: "2 + 2 等于多少？只返回一个数字。" }], reasoning: "quick", maxOutputChars: 1000 }, AbortSignal.timeout(160_000), () => { firstOutputMs ??= Math.round(performance.now() - start); });
  const passed = result.text.trim() === "4" && (live || received);
  console.log(JSON.stringify({ live, provider: executor.identity.provider, model: executor.identity.model, passed, durationMs: Math.round(performance.now() - start), firstOutputMs, outputDelivery: "completed-message", usage: result.usage }));
  if (!passed) process.exitCode = 1;
} catch (error) {
  const code = error instanceof Error && /^(native_|provider_|live_provider_)[a-z_]+$/.test(error.message) ? error.message : "probe_failed";
  console.log(JSON.stringify({ live, passed: false, error: code })); process.exitCode = 1;
} finally { server.closeAllConnections(); if (server.listening) await new Promise<void>(resolve => server.close(() => resolve())); }
