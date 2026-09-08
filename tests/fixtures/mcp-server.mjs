import readline from "node:readline";
import process from "node:process";
import fs from "node:fs";
const [mode = "modern", record] = process.argv.slice(2);
const output = value => process.stdout.write(JSON.stringify(value) + "\n");
if (mode === "malformed") process.stdout.write("not json\n");
const lines = readline.createInterface({ input: process.stdin });
lines.on("close", () => process.exit(0));
lines.on("line", line => {
  const message = JSON.parse(line);
  if (record) fs.appendFileSync(record, JSON.stringify({ method: message.method, params: message.params, id: message.id }) + "\n");
  if (!message.id) return;
  const reply = result => output({ jsonrpc: "2.0", id: message.id, result });
  const error = code => output({ jsonrpc: "2.0", id: message.id, error: { code, message: "opaque fixture error must not escape" } });
  if (message.method === "server/discover") {
    if (mode === "legacy") return error(-32602);
    if (mode === "silent") return;
    if (mode === "unsupported") return error(-32022);
    return reply({ resultType: "complete", supportedVersions: ["2026-07-28"], capabilities: { tools: {} }, _meta: { "io.modelcontextprotocol/serverInfo": { name: "Fixture", version: "1" } } });
  }
  if (message.method === "initialize") return reply({ protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "Legacy", version: "1" } });
  const complete = value => reply({ ...(mode !== "legacy" && mode !== "silent" ? { resultType: "complete" } : {}), ...value });
  if (message.method === "tools/list") return complete({ tools: [{ name: "echo", description: "Return the supplied synthetic text", inputSchema: { type: "object", properties: { text: { type: "string", minLength: 1, maxLength: 200 } }, required: ["text"], additionalProperties: false }, annotations: { readOnlyHint: true } }, { name: "write", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false }, annotations: { readOnlyHint: true } }, { name: "slow", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] });
  if (message.method === "tools/call") {
    if (mode === "disconnect-write") return process.exit(0);
    if (message.params.name === "slow") return;
    return complete({ content: [{ type: "text", text: message.params.arguments.text }], structuredContent: { text: message.params.arguments.text, inheritedPrivate: Boolean(process.env.ZHIXING_MCP_PRIVATE_FIXTURE), inheritedNodeOptions: Boolean(process.env.NODE_OPTIONS) } });
  }
  error(-32601);
});
