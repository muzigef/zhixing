import { createHash } from "node:crypto";
import readline from 'node:readline';
import fs from 'node:fs';
const [mode, record] = process.argv.slice(2);
const schema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const keyed = mode.startsWith("keyed");
const writeSchema = keyed ? { ...schema, properties: { ...schema.properties, operationKey: { type: "string", pattern: "^[a-f0-9]{64}$" } }, required: ["text", "operationKey"] } : schema;
const statusSchema = keyed ? { type: "object", properties: { operationKey: { type: "string" } }, required: ["operationKey"], additionalProperties: false } : schema;
const lines = readline.createInterface({ input: process.stdin }); lines.on('close', () => process.exit(0));
lines.on('line', line => {
  const message = JSON.parse(line); if (!message.id) return;
  const reply = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: value }) + '\n');
  if (message.method === 'server/discover') return reply({ resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'Recovery fixture', version: '1' } } });
  if (message.method === 'tools/list') return reply({ resultType: 'complete', tools: [{ name: 'write', inputSchema: writeSchema }, { name: 'status', inputSchema: statusSchema }] });
  if (message.method !== 'tools/call') return;
  fs.appendFileSync(record, JSON.stringify({ call: message.params.name, input: message.params.arguments }) + '\n');
  if (message.params.name === 'write') {
    if (mode !== 'absent') fs.appendFileSync(record, JSON.stringify({ effect: keyed ? message.params.arguments.operationKey : message.params.arguments.text, requestHash: createHash("sha256").update(JSON.stringify(message.params.arguments, Object.keys(message.params.arguments).sort())).digest("hex") }) + '\n');
    return process.exit(0); // Effect may persist, but no original response is delivered.
  }
  const reference = keyed ? message.params.arguments.operationKey : message.params.arguments.text;
  const effect = fs.readFileSync(record, 'utf8').trim().split('\n').map(line => JSON.parse(line)).find(row => row.effect === reference);
  const exists = Boolean(effect);
  reply({ resultType: 'complete', isError: mode === 'error', content: [{ type: 'text', text: 'synthetic status' }], structuredContent: { ...(keyed ? { operationKey: reference, requestHash: mode === 'keyed_wronghash' ? '0'.repeat(64) : effect?.requestHash } : {}), text: mode === 'mismatch' ? 'different operation' : reference, status: mode === 'unknown' ? 'pending' : exists ? 'succeeded' : 'not_found' } });
});
import process from "node:process";
