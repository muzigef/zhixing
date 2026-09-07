import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { mergeOutcomeExports } from "../src/outcome-report.js";

const args = process.argv.slice(2);
const outputs = args.filter(arg => arg.startsWith("--output="));
const files = args.filter(arg => !arg.startsWith("--"));
if (outputs.length > 1 || args.some(arg => arg.startsWith("--") && !arg.startsWith("--output=")) || !files.length || files.length > 100) throw new Error("usage: npm run eval:learning -- export1.json export2.json [--output=summary.json]");
const reports = [];
for (const file of files) {
  const handle = await fs.open(path.resolve(file), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 4_000_000) throw new Error("outcome_export_size_limit");
    reports.push(JSON.parse(await handle.readFile("utf8")));
  } finally { await handle.close(); }
}
const result = JSON.stringify(mergeOutcomeExports(reports), null, 2) + "\n";
if (outputs[0]) await fs.writeFile(path.resolve(outputs[0].slice(9)), result, { flag: "wx", mode: 0o600 });
else process.stdout.write(result);
