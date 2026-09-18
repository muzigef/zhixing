import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
const denied = value => /(?:^|[/\\])(?:\.env[^/\\]*|auth\.json|credentials?[^/\\]*|\.ssh|\.codex)(?:[/\\]|$)/i.test(value);
export async function evaluationPath(selected, writing = false) {
  if (typeof selected !== "string" || !/\.json$/i.test(selected)) throw new Error("evaluation_json_required");
  const resolved = path.resolve(selected);
  if (denied(resolved) || denied(await fs.realpath(writing ? path.dirname(resolved) : resolved))) throw new Error("evaluation_path_denied");
  return resolved;
}
export async function readEvaluationJson(selected, maxBytes = 16_000_000) {
  const resolved = await evaluationPath(selected), handle = await fs.open(resolved, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes) throw new Error("evaluation_size_limit"); return JSON.parse(await handle.readFile("utf8")); } finally { await handle.close(); }
}
export async function writeEvaluationJson(selected, value) {
  await fs.writeFile(await evaluationPath(selected, true), JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
}

export async function createEvaluationDirectory(selected) {
  if (typeof selected !== "string" || !selected.trim()) throw new Error("evaluation_directory_required");
  const resolved = path.resolve(selected);
  if (denied(resolved) || denied(await fs.realpath(path.dirname(resolved)))) throw new Error("evaluation_path_denied");
  await fs.mkdir(resolved, { mode: 0o700 }); return resolved;
}
