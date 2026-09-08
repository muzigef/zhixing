import path from "node:path";
import fs from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { LocalSandbox, type SandboxResult } from "./local-sandbox.js";
const exec = promisify(execFile);
export async function runPythonTests(files: Record<string, string>, tests: string[], signal: AbortSignal, timeoutMs: number): Promise<SandboxResult> {
  const deadline = Date.now() + timeoutMs;
  const unavailable: SandboxResult = { status: "unavailable", stdout: "", stderr: "本机没有可验证的 Python 标准库隔离运行环境。", exitCode: null };
  if (process.platform !== "darwin") return unavailable;
  let runtime: { executable: string; prefix: string } | undefined;
  for (const candidate of ["/usr/bin/python3", "/opt/homebrew/bin/python3"]) {
    signal.throwIfAborted();
    try {
      const { stdout } = await exec(candidate, ["-I", "-S", "-c", "import json,sys; print(json.dumps({'executable':sys.executable,'prefix':sys.base_prefix}))"], { signal, timeout: Math.max(1, Math.min(deadline - Date.now(), 2000)), maxBuffer: 4000, env: { PATH: "/usr/bin:/bin" } });
      const value = JSON.parse(stdout) as { executable: string; prefix: string };
      const executable = await fs.realpath(value.executable); const prefix = await fs.realpath(value.prefix);
      if (!["/Applications/Xcode.app/Contents/Developer/", "/Library/Developer/CommandLineTools/", "/opt/homebrew/Cellar/", "/System/Library/"].some(root => executable.startsWith(root) && prefix.startsWith(root))) continue;
      const frameworkExecutable = path.join(prefix, "Resources/Python.app/Contents/MacOS/Python");
      const direct = await fs.realpath(frameworkExecutable).catch(() => executable);
      runtime = { executable: direct, prefix }; break;
    } catch { signal.throwIfAborted(); }
  }
  if (!runtime) return unavailable;
  const script = `import importlib.util, os, sys, unittest\nsys.path.insert(0, os.getcwd())\nsuite = unittest.TestSuite()\nfor index, file in enumerate(${JSON.stringify(tests)}):\n spec = importlib.util.spec_from_file_location('zhixing_test_' + str(index), file)\n module = importlib.util.module_from_spec(spec)\n spec.loader.exec_module(module)\n suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))\nif suite.countTestCases() == 0:\n print('No unittest cases found', file=sys.stderr)\n sys.exit(1)\nresult = unittest.TextTestRunner(verbosity=2).run(suite)\nsys.exit(0 if result.wasSuccessful() else 1)\n`;
  return new LocalSandbox().run(runtime.executable, ["-I", "-S", "-B", "zhixing_runner.py"], { files: { ...files, "zhixing_runner.py": script }, allowedCommands: [runtime.executable], runtimeReadPath: runtime.prefix, timeoutMs: Math.max(1, deadline - Date.now()), signal });
}
