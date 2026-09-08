import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createBlindReviewPacket } from "../src/outcome-blind-review.js";
const [input, outputArg, ...rest] = process.argv.slice(2);
if (!input || !outputArg?.startsWith("--output=") || rest.length) throw new Error("usage: node --import tsx scripts/create-outcome-review-pack.ts exported.json --output=new-directory");
const selected = path.resolve(input), output = path.resolve(outputArg.slice(9));
if (/(?:^|[/\\])(?:\.env[^/\\]*|auth\.json|credentials?[^/\\]*|\.ssh|\.codex)(?:[/\\]|$)/i.test(selected)) throw new Error("outcome_path_denied");
const handle = await fs.open(selected, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
let result: ReturnType<typeof createBlindReviewPacket>;
try { const stat = await handle.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4_000_000) throw new Error("outcome_export_size_limit"); result = createBlindReviewPacket(JSON.parse(await handle.readFile("utf8"))); } finally { await handle.close(); }
await fs.mkdir(output, { mode: 0o700 }); // Exclusive directory; never overwrite previous packs.
await fs.writeFile(path.join(output, "reviewer.json"), JSON.stringify(result.packet, null, 2) + "\n", { flag: "wx", mode: 0o600 });
await fs.writeFile(path.join(output, "coordinator-private.json"), JSON.stringify(result.coordinator, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ prepared: result.packet.items.length, humanReviewsCompleted: 0, output }));
