import { existsSync } from "node:fs";
import { windowsSandboxHelper } from "./windows-sandbox.js";
/** A preflight, not a substitute for the actual isolated execution result. */
export function executionSupport(platform: NodeJS.Platform = process.platform, sandboxPresent = platform === "win32" ? Boolean(windowsSandboxHelper()) : existsSync("/usr/bin/sandbox-exec")) {
  const supported = platform === "darwin" || platform === "win32";
  const available = supported && sandboxPresent;
  return { available, platform, verification: "runtime_result_required" as const,
    reason: available ? "sandbox_present" : !supported ? "platform_unsupported" : "sandbox_missing",
    message: available ? `已找到 ${platform === "win32" ? "Windows AppContainer" : "macOS 系统"}沙箱；测试是否成功仍以实际运行结果为准。` : !supported ? "本平台可使用对话与资料功能，实践代码执行暂无已验证的系统沙箱。" : "未找到系统沙箱，暂不能执行实践代码。" };
}
export function assertExecutionSupport(platform: NodeJS.Platform = process.platform, sandboxPresent?: boolean): void {
  if (!executionSupport(platform, sandboxPresent).available) throw new Error("platform_execution_unavailable");
}
