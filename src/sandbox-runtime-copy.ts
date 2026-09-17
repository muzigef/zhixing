import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";

/** Private stdlib snapshot: never follow links or copy third-party/cache files.
 * Plan byte limits first, then use bounded I/O. All workers settle before the
 * caller may remove the private directory on cancellation or failure. */
export async function copySandboxRuntimeDirectory(source: string, target: string, usedBytes: number, maxBytes: number, signal?: AbortSignal): Promise<number> {
  const files: { from: string; to: string }[] = [];
  let entries = 0;
  const pending = [{ from: source, to: target, depth: 0 }];
  const inspect = async ({ from, to, depth }: typeof pending[number]): Promise<void> => {
    signal?.throwIfAborted();
    if (++entries > 20_000 || depth > 32) throw new Error("sandbox_runtime_limit");
    if (["site-packages", "__pycache__"].includes(path.basename(from).toLowerCase())) return;
    const stat = await fs.lstat(from);
    if (stat.isSymbolicLink()) return;
    if (stat.isDirectory()) {
      await fs.mkdir(to, { recursive: true });
      const names = await fs.readdir(from);
      if (entries + pending.length + names.length > 20_000) throw new Error("sandbox_runtime_limit");
      for (const name of names) pending.push({ from: path.join(from, name), to: path.join(to, name), depth: depth + 1 });
    } else if (stat.isFile()) {
      usedBytes += stat.size;
      if (usedBytes > maxBytes) throw new Error("sandbox_runtime_limit");
      files.push({ from, to });
    }
  };
  while (pending.length) {
    const results = await Promise.allSettled(pending.splice(0, 8).map(inspect));
    const rejected = results.find(result => result.status === "rejected");
    if (rejected?.status === "rejected") throw rejected.reason;
  }
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
