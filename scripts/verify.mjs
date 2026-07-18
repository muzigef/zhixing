import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const commands = [
  ["npm", ["run", "lint"]],
  ["npm", ["run", "typecheck"]],
  ["npm", ["run", "test"]],
  ["npm", ["run", "test:integration"]],
  ["npm", ["run", "eval"]],
  ["npm", ["run", "smoke:mock"]],
];

for (const [command, args] of commands) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const files = collect(root).filter((file) => /\.(?:[cm]?[jt]s|md|json|ya?ml)$/i.test(file));
const forbidden = [
  { name: "focused/skipped test", pattern: /\b(?:it|test|describe)\.(?:only|skip)\s*\(/ },
  { name: "probable API credential", pattern: /\b(?:sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,})/i },
];
for (const file of files) {
  const content = readFileSync(file, "utf8");
  for (const rule of forbidden) {
    if (rule.pattern.test(content)) {
      console.error(`verify failed: ${rule.name} in ${relative(root, file)}`);
      process.exit(1);
    }
  }
}

const git = spawnSync("git", ["diff", "--check"], { cwd: root, encoding: "utf8" });
if (git.status !== 0 && git.status !== 129) {
  process.stderr.write(git.stderr);
  process.exit(git.status ?? 1);
}
console.log("verify passed: quality gates, sensitive scan, and diff whitespace check");

function collect(directory) {
  const ignored = new Set(["node_modules", "data", "db", "inbox", "coverage", ".git"]);
  const files = [];
  for (const entry of readdirSync(directory)) {
    if (ignored.has(entry)) continue;
    const full = join(directory, entry);
    if (statSync(full).isDirectory()) files.push(...collect(full));
    else files.push(full);
  }
  return files;
}
