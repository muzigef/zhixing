import path from "node:path";
import fs from "node:fs/promises";
import { hostProcess } from "./process-gateway.js";
const { execFile } = hostProcess("python-discovery");
import { promisify } from "node:util";
import { LocalSandbox, type SandboxResult } from "./local-sandbox.js";
const exec = promisify(execFile);
export async function runPythonTests(files: Record<string, string>, tests: string[], signal: AbortSignal, timeoutMs: number, observe?: (stage: "locate" | "inspect" | "sandbox") => void): Promise<SandboxResult> {
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(0, deadline - Date.now());
  const timedOut: SandboxResult = { status: "timed_out", stdout: "", stderr: "Python 任务时间预算已耗尽。", exitCode: null };
  signal.throwIfAborted();
  if (!remaining()) return timedOut;
  const unavailable: SandboxResult = { status: "unavailable", stdout: "", stderr: "本机没有可验证的 Python 标准库隔离运行环境。", exitCode: null };
  if (!["darwin", "win32", "linux"].includes(process.platform)) return unavailable;
  const diagnostics: string[] = [];
  const failure = (stage: string, error: unknown) => {
    const value = error as { killed?: boolean; code?: unknown };
    const code = typeof value?.code === "string" && /^[A-Z0-9_]{1,40}$/.test(value.code) ? value.code : value?.killed ? "probe_timeout" : "probe_failed";
    diagnostics.push(`${stage}:${code}`);
    return code;
  };
  const missing = () => ({ ...unavailable, stderr: `${unavailable.stderr} [${diagnostics.join(",") || "runtime_rejected"}]` });
  let runtime: { executable: string; prefix: string } | undefined;
  let candidates = ["/usr/bin/python3", "/opt/homebrew/bin/python3", "/usr/local/bin/python3"];
  if (process.platform === "win32") {
    try {
      observe?.("locate");
      const { stdout } = await exec(path.join(process.env.SystemRoot ?? "C:\\Windows", "System32/where.exe"), ["python.exe"], { signal, timeout: Math.max(1, remaining()), maxBuffer: 8000, windowsHide: true });
      candidates = stdout.trim().split(/\r?\n/).filter(file => path.isAbsolute(file) && !file.toLowerCase().includes("windowsapps")).slice(0, 4);
    } catch (error) { signal.throwIfAborted(); return failure("locate", error) === "probe_timeout" || !remaining() ? timedOut : missing(); }
  }
  for (const candidate of candidates) {
    signal.throwIfAborted();
    if (!remaining()) return timedOut;
    try {
      observe?.("inspect");
      const { stdout } = await exec(candidate, ["-I", "-S", "-c", "import json,sys; print(json.dumps({'executable':sys.executable,'prefix':sys.base_prefix}))"], { signal, timeout: Math.max(1, remaining()), maxBuffer: 4000, windowsHide: true, env: process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : { PATH: "/usr/bin:/bin" } });
      const value = JSON.parse(stdout) as { executable: string; prefix: string };
      const executable = await fs.realpath(value.executable); const prefix = await fs.realpath(value.prefix);
      if (process.platform === "win32") {
        if (path.dirname(executable).toLowerCase() !== prefix.toLowerCase() || !/^python(?:3(?:\.\d+)?)?\.exe$/i.test(path.basename(executable))) continue;
        runtime = { executable, prefix }; break;
      }
      if (process.platform === "linux") {
        if (executable.startsWith("/usr/bin/") && prefix === "/usr") { runtime = { executable, prefix }; break; }
        continue;
      }
      const trustedRoots = ["/Applications/Xcode.app/Contents/Developer/", "/Library/Developer/CommandLineTools/", "/opt/homebrew/Cellar/", "/usr/local/Cellar/", "/System/Library/"];
      const versionedXcode = /^\/Applications\/Xcode_[0-9][a-zA-Z0-9._-]*\.app\/Contents\/Developer\//.exec(executable)?.[0];
      if (versionedXcode) trustedRoots.push(versionedXcode);
      if (!trustedRoots.some(root => executable.startsWith(root) && prefix.startsWith(root))) continue;
      const frameworkExecutable = path.join(prefix, "Resources/Python.app/Contents/MacOS/Python");
      const direct = await fs.realpath(frameworkExecutable).catch(() => executable);
      runtime = { executable: direct, prefix }; break;
    } catch (error) { signal.throwIfAborted(); if (failure("inspect", error) === "probe_timeout" || !remaining()) return timedOut; }
  }
  signal.throwIfAborted();
  if (!remaining()) return timedOut;
  if (!runtime) return missing();
  const script = `import importlib.util, os, sys, unittest\nsys.path.insert(0, os.getcwd())\nsuite = unittest.TestSuite()\nfor index, file in enumerate(${JSON.stringify(tests)}):\n spec = importlib.util.spec_from_file_location('zhixing_test_' + str(index), file)\n module = importlib.util.module_from_spec(spec)\n spec.loader.exec_module(module)\n suite.addTests(unittest.defaultTestLoader.loadTestsFromModule(module))\nif suite.countTestCases() == 0:\n print('No unittest cases found', file=sys.stderr)\n sys.exit(1)\nresult = unittest.TextTestRunner(verbosity=2).run(suite)\nsys.exit(0 if result.wasSuccessful() else 1)\n`;
  observe?.("sandbox");
  // The shared deadline also covers private runtime preparation, not only the
  // final child process. Await sandbox cleanup before returning its timeout.
  const deadlineSignal = AbortSignal.timeout(Math.max(1, remaining()));
  try {
    const result = await new LocalSandbox().run(runtime.executable, ["-I", "-S", "-B", "zhixing_runner.py"], { files: { ...files, "zhixing_runner.py": script }, allowedCommands: [runtime.executable], runtimeReadPath: runtime.prefix, timeoutMs: Math.max(1, remaining()), signal: AbortSignal.any([signal, deadlineSignal]) });
    signal.throwIfAborted();
    // Completion is decided before private-directory cleanup. A deadline that
    // arrives during cleanup cannot retroactively cancel finished work.
    return result.status === "cancelled" && deadlineSignal.aborted ? { ...result, status: "timed_out", stderr: result.stderr || timedOut.stderr } : result;
  } catch (error) {
    signal.throwIfAborted();
    if (deadlineSignal.aborted || !remaining()) return timedOut;
    throw error;
  }
}
