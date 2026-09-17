import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

/** Private stdlib snapshot: never follow links or copy third-party/cache files.
 * Plan byte limits first, then use bounded I/O. All workers settle before the
 * caller may remove the private directory on cancellation or failure. */
export async function copySandboxRuntimeDirectory(source: string, target: string, usedBytes: number, maxBytes: number, signal?: AbortSignal): Promise<number> {
  const files: { from: string; to: string }[] = [];
  let entries = 0;
  const scan = async (from: string, to: string, depth: number): Promise<void> => {
    signal?.throwIfAborted();
    if (++entries > 20_000 || depth > 32) throw new Error("sandbox_runtime_limit");
    if (["site-packages", "__pycache__"].includes(path.basename(from).toLowerCase())) return;
    const stat = await fs.lstat(from);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      await fs.mkdir(to, { recursive: true });
      for (const name of await fs.readdir(from)) await scan(path.join(from, name), path.join(to, name), depth + 1);
    } else if (stat.isFile()) {
      usedBytes += stat.size;
      if (usedBytes > maxBytes) throw new Error("sandbox_runtime_limit");
      files.push({ from, to });
    }
  };
  await scan(source, target, 0);
  let next = 0, failed = false; let failure: unknown;
  const worker = async () => {
    try {
      while (!failed && next < files.length) {
        signal?.throwIfAborted();
        const file = files[next++]!;
        await fs.copyFile(file.from, file.to, constants.COPYFILE_EXCL);
      }
    } catch (error) { if (!failed) { failed = true; failure = error; } }
  };
  await Promise.all(Array.from({ length: Math.min(8, files.length) }, worker));
  if (failed) throw failure;
  signal?.throwIfAborted();
  return usedBytes;
}
