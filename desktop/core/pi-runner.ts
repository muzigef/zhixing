import path from "node:path";
import {
  runPiProcess,
  type PiProcessRunner,
  type PiProcessRequest,
} from "../../src/pi-client.js";

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
