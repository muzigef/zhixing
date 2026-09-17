import { PosixSandboxBackend } from "./posix-sandbox.js";
import { WindowsSandboxBackend } from "./windows-sandbox.js";
import type { SandboxBackend } from "./sandbox-types.js";
/** Platform selection is owned by the host, never provided by a model request. */
export function sandboxBackend(platform: NodeJS.Platform = process.platform, macExecutable?: string): SandboxBackend | undefined {
  if (platform === "darwin" || platform === "linux") return new PosixSandboxBackend(platform, macExecutable);
  if (platform === "win32") return new WindowsSandboxBackend();
  return undefined;
}
