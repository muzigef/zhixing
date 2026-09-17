import fs from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { hostProcess } from "../src/process-gateway.js";
import { promisify } from "node:util";
import ts from "typescript";

it("allows raw process creation only in reviewed sandbox backends and the host gateway", async () => {
  const allowed = new Set(["src/process-gateway.ts", "src/posix-sandbox.ts", "src/windows-sandbox.ts"]);
  const violations: string[] = [];
  const hostAdapters: Record<string, string> = {
    "src/build-provenance.ts": "build-provenance", "src/practice-projects.ts": "git-storage", "src/ocr.ts": "ocr",
    "src/python-runner.ts": "python-discovery", "src/native-agent.ts": "native-provider", "src/pi-client.ts": "pi-provider",
    "src/macos-keychain.ts": "keychain", "desktop/electron/secrets.ts": "keychain", "src/mcp-connection.ts": "trusted-mcp",
  };
  async function visit(directory: string): Promise<void> {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const file = path.posix.join(directory, entry.name);
      if (entry.isDirectory()) { await visit(file); continue; }
      if (!/\.tsx?$/.test(file)) continue;
      const source = ts.createSourceFile(file, await fs.readFile(file, "utf8"), ts.ScriptTarget.Latest, true);
      const check = (node: ts.Node) => {
        if (ts.isStringLiteral(node) && /^(?:node:)?child_process$/.test(node.text) && !allowed.has(file)) violations.push(file);
        if (ts.isStringLiteral(node) && /^(?:node:)?worker_threads$/.test(node.text) && file !== "src/json-schema-worker.ts") violations.push(file);
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "hostProcess") {
          const purpose = node.arguments[0];
          if (!purpose || !ts.isStringLiteral(purpose) || hostAdapters[file] !== purpose.text) violations.push(file);
        }
        ts.forEachChild(node, check);
      }; check(source);
    }
  }
  for (const root of ["src", "desktop/core", "desktop/electron", "desktop/renderer"]) await visit(root);
  expect([...new Set(violations)]).toEqual([]);
});

it("rejects shell escalation and command-purpose mismatch, including promisified calls", async () => {
  const gateway = hostProcess("build-provenance");
  expect(() => gateway.spawn("git", ["status"], { shell: true })).toThrow("host_process_denied");
  expect(() => gateway.spawn(process.execPath, ["-e", "process.exit(0)"])).toThrow("host_process_denied");
  await expect(promisify(gateway.execFile)(process.execPath, ["--version"], { timeout: 1000 })).rejects.toThrow("host_process_denied");
  const result = await promisify(gateway.execFile)("git", ["--version"], { timeout: 2000 });
  expect(result.stdout).toMatch(/^git version/);
});
