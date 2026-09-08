import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
const exec = promisify(execFile);
it("资料问答在无检索证据时不会调用模型", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-cli-no-evidence-"));
  try {
    const result = await exec(process.execPath, ["--import", "tsx", "src/cli.ts", "资料问答 RAG"], { cwd: process.cwd(), env: { ...process.env, ZHIXING_ROOT: root, ZHIXING_ALLOW_LIVE_PROVIDER: "0" } });
    expect(result.stdout).toContain("insufficient_evidence");
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
