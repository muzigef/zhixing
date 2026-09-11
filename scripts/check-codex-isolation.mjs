import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Only synthetic files. Never inspect account files or run a model request.
if (process.platform !== "darwin") throw new Error("This acceptance probe currently verifies macOS only.");
const run = promisify(execFile);
const executable = process.env.ZHIXING_CODEX_EXECUTABLE || "codex";
const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-codex-isolation-"));
try {
  const allowed = path.join(root, "allowed"), outside = path.join(root, "outside.txt");
  await fs.mkdir(allowed, { mode: 0o700 });
  await fs.writeFile(path.join(allowed, "inside.txt"), "SYNTHETIC_ALLOWED");
  await fs.writeFile(outside, "SYNTHETIC_OUTSIDE");
  await fs.symlink(outside, path.join(allowed, "escape.txt"));
  const config = `permissions={zhixing_context={filesystem={":minimal"="read",${JSON.stringify(allowed)}="read"},network={enabled=false}}}`;
  const results = [];
  for (const [name, command, expected] of [
    ["allowed-read", ["/bin/cat", path.join(allowed, "inside.txt")], true],
    ["outside-read", ["/bin/cat", outside], false],
    ["symlink-escape", ["/bin/cat", path.join(allowed, "escape.txt")], false],
    ["write-denied", ["/usr/bin/touch", path.join(allowed, "new.txt")], false],
  ]) {
    let succeeded = false;
    try { await run(executable, ["sandbox", "-c", config, "-P", "zhixing_context", "-C", allowed, ...command], { timeout: 15000, maxBuffer: 64000 }); succeeded = true; }
    catch (error) { if (error.killed || typeof error.code !== "number") throw new Error("isolation_probe_unavailable"); }
    results.push({ name, passed: succeeded === expected });
  }
  console.log(JSON.stringify({ platform: process.platform, results }));
  if (results.some(item => !item.passed)) process.exitCode = 1;
} finally { await fs.rm(root, { recursive: true, force: true }); }
