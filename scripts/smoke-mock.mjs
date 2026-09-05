import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The quality gate must not open the learner's real database or reconcile their runs.
const root = await mkdtemp(path.join(os.tmpdir(), "zhixing-smoke-"));
try {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", "主题列表"], {
    cwd: process.cwd(), stdio: "inherit",
    env: { ...process.env, ZHIXING_ROOT: root, ZHIXING_ALLOW_LIVE_PROVIDER: "0" },
  });
  process.exitCode = result.status ?? 1;
} finally { await rm(root, { recursive: true, force: true }); }
