import readline from 'node:readline';
import fs from 'node:fs';
const [mode, record] = process.argv.slice(2);
const schema = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false };
const lines = readline.createInterface({ input: process.stdin }); lines.on('close', () => process.exit(0));
lines.on('line', line => {
  const message = JSON.parse(line); if (!message.id) return;
  const reply = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: value }) + '\n');
  if (message.method === 'server/discover') return reply({ resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: { tools: {} }, _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'Recovery fixture', version: '1' } } });
  if (message.method === 'tools/list') return reply({ resultType: 'complete', tools: [{ name: 'write', inputSchema: schema }, { name: 'status', inputSchema: schema }] });
  if (message.method !== 'tools/call') return;
  fs.appendFileSync(record, JSON.stringify({ call: message.params.name }) + '\n');
  if (message.params.name === 'write') {
    if (mode !== 'absent') fs.appendFileSync(record, JSON.stringify({ effect: message.params.arguments.text }) + '\n');
    return process.exit(0); // Effect may persist, but no original response is delivered.
  }
  const reference = message.params.arguments.text;
  const exists = fs.readFileSync(record, 'utf8').trim().split('\n').map(line => JSON.parse(line)).some(row => row.effect === reference);
  reply({ resultType: 'complete', content: [{ type: 'text', text: 'synthetic status' }], structuredContent: { text: mode === 'mismatch' ? 'different operation' : reference, status: mode === 'unknown' ? 'pending' : exists ? 'succeeded' : 'not_found' } });
});
import process from "node:process";
