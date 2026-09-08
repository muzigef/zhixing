import { existsSync } from "node:fs";
/** A preflight, not a substitute for the actual isolated execution result. */
export function executionSupport(platform: NodeJS.Platform = process.platform, sandboxPresent = existsSync("/usr/bin/sandbox-exec")) {
  const available = platform === "darwin" && sandboxPresent;
  return { available, platform, verification: "runtime_result_required" as const,
    reason: available ? "sandbox_present" : platform !== "darwin" ? "platform_unsupported" : "sandbox_missing",
    message: available ? "已找到 macOS 系统沙箱；测试是否成功仍以实际运行结果为准。" : platform !== "darwin" ? "本平台可使用对话与资料功能，实践代码执行和受限 MCP 暂无已验证的系统沙箱。" : "未找到 macOS 系统沙箱，暂不能执行实践代码或受限 MCP。" };
}
export function assertExecutionSupport(platform: NodeJS.Platform = process.platform, sandboxPresent?: boolean): void {
  if (!executionSupport(platform, sandboxPresent).available) throw new Error("platform_execution_unavailable");
}
