import fs from "node:fs/promises";
import path from "node:path";
import {
  runPiProcess,
  type PiProcessRunner,
  type PiProcessRequest,
} from "../../src/pi-client.js";

/** Follow Pi's public executable entry; internal dist modules are not standalone CLIs. */
export async function resolvePackagedPiCli(appPath: string): Promise<string> {
  const packageRoot = path.join(appPath.replace(/app\.asar$/, "app.asar.unpacked"), "node_modules/@earendil-works/pi-coding-agent");
  const metadata = JSON.parse(await fs.readFile(path.join(packageRoot, "package.json"), "utf8")) as { bin?: { pi?: unknown } };
  const entry = metadata.bin?.pi;
  if (typeof entry !== "string" || !entry || path.isAbsolute(entry)) throw new Error("pi_entry_invalid");
  const cli = path.resolve(packageRoot, entry);
  const relative = path.relative(packageRoot, cli);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("pi_entry_invalid");
  await fs.access(cli);
  return cli;
}

/** Equivalent to pi-safe.sh, with the packaged Node runtime and no platform shell. */
export function packagedPiRequest(
  request: PiProcessRequest,
  executable: string,
  cli: string,
  guard: string,
): PiProcessRequest {
  if (path.basename(request.args[0] ?? "") !== "pi-safe.sh")
    throw new Error("pi_launcher_invalid");
  return {
    ...request,
    command: executable,
    args: [
      cli,
      "--approve",
      "--no-extensions",
      "-e",
      guard,
      ...request.args.slice(1),
    ],
    environment: { ...request.environment, ELECTRON_RUN_AS_NODE: "1" },
  };
}
export function packagedPiRunner(
  executable: string,
  cli: string,
  guard: string,
): PiProcessRunner {
  return (request, signal) =>
    runPiProcess(packagedPiRequest(request, executable, cli, guard), signal);
}
