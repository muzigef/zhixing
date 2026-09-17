import { spawn as rawSpawn, execFile as rawExecFile, type SpawnOptions, type ExecFileOptions } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

/** These host adapters are trusted application code, NOT OS-isolated execution.
 * Keep the inventory small; untrusted code must use LocalSandbox instead. No
 * command, arguments, environment values or process output are logged here. */
export type HostProcessPurpose = "git-storage" | "build-provenance" | "keychain" | "python-discovery" | "ocr" | "native-provider" | "pi-provider" | "trusted-mcp";
const purposes = new Set<HostProcessPurpose>(["git-storage", "build-provenance", "keychain", "python-discovery", "ocr", "native-provider", "pi-provider", "trusted-mcp"]);
function admit(purpose: HostProcessPurpose, command: string, args: readonly string[], options: SpawnOptions | ExecFileOptions): void {
  if (!purposes.has(purpose) || typeof command !== "string" || !command || command.includes("\0") || !Array.isArray(args) || args.some(arg => typeof arg !== "string" || arg.includes("\0")) || options.shell) throw new Error("host_process_denied");
  const base = path.basename(command).toLowerCase();
  const allowed: Partial<Record<HostProcessPurpose, RegExp>> = {
    "git-storage": /^git(?:\.exe)?$/, "build-provenance": /^git(?:\.exe)?$/, "keychain": /^security$/,
    "python-discovery": /^(?:where\.exe|python(?:3(?:\.\d+)?)?(?:\.exe)?)$/,
    "ocr": /^(?:pdftoppm|tesseract)(?:\.exe)?$/,
  };
  if (allowed[purpose] && !allowed[purpose]!.test(base)) throw new Error("host_process_denied");
  if (purpose === "trusted-mcp" && !path.isAbsolute(command)) throw new Error("host_process_denied");
}
export function hostProcess(purpose: HostProcessPurpose): { spawn: typeof rawSpawn; execFile: typeof rawExecFile } {
  const spawn = ((command: string, args: readonly string[], options: SpawnOptions = {}) => {
    admit(purpose, command, args, options); return rawSpawn(command, args, { ...options, shell: false });
  }) as typeof rawSpawn;
  const execFile = ((command: string, args: readonly string[], options: ExecFileOptions, callback?: Parameters<typeof rawExecFile>[3]) => {
    admit(purpose, command, args, options); return rawExecFile(command, args, { ...options, shell: false }, callback);
  }) as typeof rawExecFile;
  Object.defineProperty(execFile, promisify.custom, { value: (command: string, args: readonly string[], options: ExecFileOptions) => new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => { if (error) reject(Object.assign(error, { stdout, stderr })); else resolve({ stdout, stderr }); });
  }) });
  return { spawn, execFile };
}

export type { ChildProcessWithoutNullStreams } from "node:child_process";
