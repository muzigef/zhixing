import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { exportTeamQuality, teamQualityStageSchema } from "../src/team-quality-export.js";
const arg = (name: string) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const selected = arg("report"), output = arg("output");
if (!selected || !output) throw new Error("usage: --report=team.json --output=new-quality.json --stage=final|member-1|member-2|review|followup");
const denied = (value: string) => /(?:^|[/\\])(?:\.env[^/\\]*|auth\.json|credentials?[^/\\]*|\.ssh|\.codex)(?:[/\\]|$)/i.test(value);
const input = path.resolve(selected), target = path.resolve(output);
if (denied(input) || denied(target) || denied(await fs.realpath(input)) || denied(await fs.realpath(path.dirname(target)))) throw new Error("evaluation_path_denied");
const handle = await fs.open(input, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
let raw: unknown;
try { const stat = await handle.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.size > 32_000_000) throw new Error("evaluation_size_limit"); raw = JSON.parse(await handle.readFile("utf8")); } finally { await handle.close(); }
const result = exportTeamQuality(raw, teamQualityStageSchema.parse(arg("stage") ?? "final"));
await fs.writeFile(target, JSON.stringify(result, null, 2) + "\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ output: target, planned: result.expectedResults, pendingReview: result.results.filter(row => row.review === "pending_human_review").length }));
