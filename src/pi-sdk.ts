import fs from "node:fs/promises";
import path from "node:path";

export async function resolvePiSdk(appPath: string): Promise<string> {
  const root = path.join(appPath.replace(/app\.asar$/, "app.asar.unpacked"), "node_modules/@earendil-works/pi-coding-agent");
  const metadata = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")) as { main?: string };
  if (typeof metadata.main !== "string" || path.isAbsolute(metadata.main)) throw new Error("pi_entry_invalid");
  const entry = path.resolve(root, metadata.main); const relative = path.relative(root, entry);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("pi_entry_invalid");
  await fs.access(entry); return entry;
}

