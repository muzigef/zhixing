import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

// Only install into an owned directory on a disposable Actions runner. This
// script must never replace a developer's existing application or user data.
if (process.platform !== "win32" || process.env.GITHUB_ACTIONS !== "true" || !process.env.RUNNER_TEMP || !process.env.GITHUB_ENV) {
  throw new Error("Windows installer acceptance requires a disposable GitHub Actions runner");
}
const root = path.resolve(import.meta.dirname, "..");
const metadata = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const installer = path.join(root, "release", `Zhixing-${metadata.version}-win-${process.arch}.exe`);
const directory = path.join(await fs.mkdtemp(path.join(process.env.RUNNER_TEMP, "zhixing-installed-")), "知行");
if (!path.isAbsolute(directory) || /["\r\n]/.test(directory)) throw new Error("Invalid acceptance directory");
// NSIS requires /D to be last and unquoted, including paths containing spaces.
await promisify(execFile)(installer, ["/S", `/D=${directory}`], {
  windowsVerbatimArguments: true, windowsHide: true, timeout: 120_000, maxBuffer: 8000,
});
async function hash(file) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
const files = ["知行.exe", "resources/app.asar", "resources/runtime/windows-sandbox.exe", "resources/runtime/pi-model-worker.mjs", "resources/runtime/build-provenance.json", "resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node"];
const checks = [];
for (const file of files) {
  const actual = await hash(path.join(directory, file));
  if (actual !== await hash(path.join(root, "release/win-unpacked", file))) throw new Error(`Installed file differs: ${file}`);
  checks.push({ file, sha256: actual, same: true });
}
const provenance = JSON.parse(await fs.readFile(path.join(directory, "resources/runtime/build-provenance.json"), "utf8"));
await fs.writeFile(path.join(root, "release/acceptance-windows.json"), JSON.stringify({
  version: metadata.version, installer: path.basename(installer), installerSha256: await hash(installer),
  installed: true, codeHash: provenance.codeHash, commit: provenance.commit, checks,
  interpretation: "Actual NSIS installation in an owned disposable runner directory; subsequent packaged UI step must independently succeed.",
}, null, 2) + "\n", { flag: "wx" });
await fs.appendFile(process.env.GITHUB_ENV, `ZHIXING_DESKTOP_INSTALLED_EXECUTABLE=${path.join(directory, "知行.exe").replaceAll("\\", "/")}\n`);
console.log("NSIS installation and all six installed runtime hashes verified.");
