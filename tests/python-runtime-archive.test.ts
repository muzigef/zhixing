import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { createPythonRuntimeArchive } from "../src/python-runtime-archive.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
function python(): string {
  if (process.platform !== "win32") return "/usr/bin/python3";
  if (process.env.pythonLocation) return path.join(process.env.pythonLocation, "python.exe");
  return execFileSync("where.exe", ["python.exe"], { timeout: 2000, encoding: "utf8" }).trim().split(/\r?\n/).find(file => !file.toLowerCase().includes("windowsapps"))!;
}
it("builds a private stdlib ZIP that real Python can validate and import without third-party files or links", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-python-archive-")); roots.push(root);
  const source = path.join(root, "Lib"), target = path.join(root, "stdlib.zip");
  for (const directory of ["package", "site-packages", "__pycache__"]) {
    await fs.mkdir(path.join(source, directory), { recursive: true });
    await fs.writeFile(path.join(source, directory, "__init__.py"), "answer = 42\n");
  }
  const outside = path.join(root, "outside"); await fs.mkdir(outside); await fs.writeFile(path.join(outside, "private.py"), "synthetic");
  await fs.symlink(outside, path.join(source, "linked"), process.platform === "win32" ? "junction" : "dir");
  const executable = python();
  const bytes = await createPythonRuntimeArchive(executable, source, target, 100_000, AbortSignal.timeout(10_000));
  expect(bytes).toBe((await fs.stat(target)).size);
  const code = "import sys,json,zipfile; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; sys.path.insert(0,sys.argv[1]); import package; print(json.dumps({'files':z.namelist(),'answer':package.answer}))";
  const output = execFileSync(executable, ["-I", "-S", "-B", "-c", code, target], { timeout: 10_000, encoding: "utf8" });
  expect(JSON.parse(output)).toEqual({ files: ["package/__init__.py"], answer: 42 });
}, 30_000);
it("refuses an archive that exceeds the private runtime budget", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-python-budget-")); roots.push(root);
  const source = path.join(root, "Lib"); await fs.mkdir(source); await fs.writeFile(path.join(source, "module.py"), "answer = 42");
  await expect(createPythonRuntimeArchive(python(), source, path.join(root, "stdlib.zip"), 20, AbortSignal.timeout(10_000))).rejects.toThrow("sandbox_runtime_limit");
}, 30_000);
