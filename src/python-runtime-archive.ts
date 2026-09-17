import { promisify } from "node:util";
import { hostProcess } from "./process-gateway.js";
const exec = promisify(hostProcess("python-runtime").execFile);

// Trusted, fixed preparation program. No learner code is executed on the host.
// CPython's supported ZIP import avoids creating/ACL-scanning thousands of
// individual stdlib files on each Windows invocation.
const pack = `import json, os, stat, sys, zipfile
def main():
 source, target, budget = sys.argv[1], sys.argv[2], int(sys.argv[3])
 if os.path.islink(source): raise RuntimeError('sandbox_runtime_invalid')
 total, entries = 22, 0
 with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_STORED) as archive:
  for parent, directories, files in os.walk(source, followlinks=False):
   entries += len(directories) + len(files)
   if entries > 20000: raise RuntimeError('sandbox_runtime_limit')
   directories[:] = [name for name in directories if name.lower() not in ('site-packages', '__pycache__') and not os.path.islink(os.path.join(parent, name))]
   for name in files:
    file = os.path.join(parent, name)
    info = os.lstat(file)
    if not stat.S_ISREG(info.st_mode): continue
    relative = os.path.relpath(file, source).replace(os.sep, '/')
    total += info.st_size + 76 + 2 * len(relative.encode('utf-8'))
    if total > budget: raise RuntimeError('sandbox_runtime_limit')
    archive.write(file, relative)
 print(json.dumps({'bytes': os.path.getsize(target)}))
try:
 main()
except Exception as error:
 code = str(error) if str(error) in ('sandbox_runtime_limit', 'sandbox_runtime_invalid') else 'sandbox_runtime_archive_failed'
 print(json.dumps({'error': code}))
 sys.exit(1)
`;

export async function createPythonRuntimeArchive(executable: string, source: string, target: string, maxBytes: number, signal?: AbortSignal): Promise<number> {
  signal?.throwIfAborted();
  try {
    const { stdout } = await exec(executable, ["-I", "-S", "-B", "-c", pack, source, target, String(maxBytes)], {
      signal, timeout: 10_000, maxBuffer: 4000, windowsHide: true,
      env: process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : { PATH: "/usr/bin:/bin" },
    });
    const value = JSON.parse(String(stdout)) as { bytes?: number };
    if (!Number.isSafeInteger(value.bytes) || value.bytes! < 0 || value.bytes! > maxBytes) throw new Error("sandbox_runtime_limit");
    return value.bytes!;
  } catch (error) {
    signal?.throwIfAborted();
    let code = "sandbox_runtime_archive_failed";
    try { if (JSON.parse(String((error as { stdout?: unknown }).stdout)).error === "sandbox_runtime_limit") code = "sandbox_runtime_limit"; } catch { /* Never expose host exception output. */ }
    throw new Error(code);
  }
}
