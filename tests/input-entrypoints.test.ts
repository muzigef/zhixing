import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { agentSendSchema } from "../src/agent-session-contracts.js";
import { MAX_INPUT_CHARACTERS } from "../src/input-limits.js";

const exec = promisify(execFile);
it.each([8_001, MAX_INPUT_CHARACTERS, MAX_INPUT_CHARACTERS + 1])("applies the shared send boundary at the actual CLI entry (%i characters)", async length => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-input-boundary-"));
  try {
    const text = "解释缓存" + "甲".repeat(length - 4);
    const accepted = agentSendSchema.safeParse({ sessionId: crypto.randomUUID(), text, provider: "mock", style: "adaptive" }).success;
    const { stdout } = await exec(process.execPath, ["--import", "tsx", "src/cli.ts", text], {
      cwd: process.cwd(), timeout: 15_000, maxBuffer: 512_000,
      env: { ...process.env, ZHIXING_ROOT: root, ZHIXING_ALLOW_LIVE_PROVIDER: "0" },
    });
    expect(stdout.includes("这条消息太长")).toBe(!accepted);
    if (accepted) expect(stdout.trim().length).toBeGreaterThan(0);
    else expect(stdout).toContain("20,000");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}, 20_000);
