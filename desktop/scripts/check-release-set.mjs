import fs from "node:fs/promises";
import path from "node:path";
import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
const [directory] = process.argv.slice(2), tag = process.env.RELEASE_TAG;
if (!directory || !/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(tag ?? "")) throw new Error("release_set_arguments_invalid");
const files = (await fs.readdir(directory)).filter(file => /^release-acceptance-[\w-]+\.json$/.test(file));
if (files.length !== 3) throw new Error("release_set_incomplete");
const expected = new Set(["darwin/arm64", "darwin/x64", "win32/x64"]), codeHashes = new Set();
for (const file of files) {
  const receipt = JSON.parse(await fs.readFile(path.join(directory, file), "utf8")), target = `${receipt.platform}/${receipt.arch}`;
  if (receipt.version !== 1 || receipt.channel !== "formal" || receipt.passed !== true || receipt.formalReady !== true || receipt.appVersion !== tag.slice(1) || receipt.problems?.length !== 0 || !expected.delete(target) || !/^[a-f0-9]{64}$/.test(receipt.identity?.codeHash ?? "")) throw new Error("release_set_receipt_invalid");
  codeHashes.add(receipt.identity.codeHash);
  const suffixes = receipt.platform === "darwin" ? ["dmg", "zip"] : ["exe"];
  for (const suffix of suffixes) {
    const artifact = receipt.artifacts?.find(item => item.file === `Zhixing-${receipt.appVersion}-${receipt.platform === "darwin" ? "mac" : "win"}-${receipt.arch}.${suffix}`);
    if (!artifact || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw new Error("release_set_artifact_missing");
    const full = path.join(directory, artifact.file), stat = await fs.lstat(full);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("release_set_artifact_invalid");
    const hash = createHash("sha256"); for await (const chunk of createReadStream(full)) hash.update(chunk);
    if (hash.digest("hex") !== artifact.sha256) throw new Error("release_set_artifact_changed");
  }
}
if (expected.size || codeHashes.size !== 1) throw new Error("release_set_build_mismatch");
console.log("All three formal platform receipts and five exact distribution artifact hashes verified.");
