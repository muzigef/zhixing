import fs from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { imageFromBytes, MAX_IMAGE_BYTES, type ImageInput } from "./image-input.js";
/** Explicit CLI attachment selection; never a model-controlled filesystem path. */
export async function readImageFile(file: string): Promise<ImageInput> {
  const selected = path.resolve(file), canonical = await fs.realpath(selected);
  if ((await fs.lstat(selected)).isSymbolicLink() || /(?:^|[\\/])(?:\.codex|\.ssh|\.pi|\.env[^\\/]*|auth\.json|credentials?)(?:[\\/]|$)/i.test(canonical)) throw new Error("image_path_denied");
  const handle = await fs.open(canonical, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = await handle.stat(); if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_IMAGE_BYTES) throw new Error("image_size_limit"); return imageFromBytes(path.basename(canonical), new Uint8Array(await handle.readFile())); }
  finally { await handle.close(); }
}
