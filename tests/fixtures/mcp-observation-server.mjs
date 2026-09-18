import readline from "node:readline";
import process from "node:process";
import fs from "node:fs";
const [versions, record] = process.argv.slice(2);
const lines = readline.createInterface({ input: process.stdin }); lines.on("close", () => process.exit(0));
lines.on("line", line => {
  const request = JSON.parse(line); if (!request.id) return;
  const reply = result => process.stdout.write(JSON.stringify({jsonrpc:"2.0", id:request.id, result:{ resultType:"complete", ...result }}) + "\n");
  if (request.method === "server/discover") return reply({ supportedVersions:["2026-07-28"], capabilities:{tools:{}} });
  if (request.method === "tools/list") return reply({ tools:[{ name:"read", inputSchema:{type:"object",properties:{id:{type:"string"},detail:{type:"boolean"}},required:["id"],additionalProperties:false} }] });
  if (request.method === "tools/call") {
    fs.appendFileSync(record, JSON.stringify(request.params.arguments) + "\n");
    return reply({content:[{type:"text",text:"synthetic observation"}],structuredContent:{id:request.params.arguments.id,version:fs.readFileSync(versions,"utf8"),noise:Date.now()}});
  }
});
