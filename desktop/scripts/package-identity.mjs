import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { extractFile } from "@electron/asar";
export const sha256 = value => createHash("sha256").update(value).digest("hex");
export async function hashFile(file) { const hash = createHash("sha256"); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest("hex"); }
export async function packageIdentity(executable, platform = process.platform) {
  if (!["darwin", "win32"].includes(platform) || !executable || !path.isAbsolute(executable)) throw new Error("packaged_executable_required");
  const resolved = await fs.realpath(executable), bytes = await fs.readFile(resolved);
  let arch;
  if (platform === "darwin" && bytes.readUInt32LE(0) === 0xfeedfacf) arch = ({ [0x0100000c]: "arm64", [0x01000007]: "x64" })[bytes.readUInt32LE(4)];
  if (platform === "win32" && bytes.toString("ascii", 0, 2) === "MZ") {
    const offset = bytes.readUInt32LE(0x3c);
    if (offset + 6 <= bytes.length && bytes.readUInt32LE(offset) === 0x4550) arch = ({ [0x8664]: "x64", [0xaa64]: "arm64" })[bytes.readUInt16LE(offset + 4)];
  }
  if (!arch) throw new Error("packaged_architecture_invalid");
  const application = platform === "darwin" ? path.dirname(path.dirname(path.dirname(resolved))) : path.dirname(resolved);
  const resources = platform === "darwin" ? path.join(application, "Contents/Resources") : path.join(application, "resources");
  const asar = path.join(resources, "app.asar"), provenance = JSON.parse(await fs.readFile(path.join(resources, "runtime/build-provenance.json"), "utf8"));
  const metadata = JSON.parse(extractFile(asar, "package.json").toString("utf8"));
  if (provenance.kind !== "packaged_build" || !/^[a-f0-9]{64}$/.test(provenance.codeHash) || typeof metadata.version !== "string") throw new Error("packaged_provenance_invalid");
  return { executable: resolved, application, resources, platform, arch, version: metadata.version, identity: { executableSha256: sha256(bytes), resourcesSha256: await hashFile(asar), codeHash: provenance.codeHash } };
}
