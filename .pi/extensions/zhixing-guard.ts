import { appendFile, mkdir } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SENSITIVE_SEGMENTS = [".env", ".ssh", ".codex", "auth.json", "credentials", "keychain", "node_modules"];
// User materials and generated state must reach models only through the controlled Runtime, never raw tools.
const USER_DATA_SEGMENTS = ["inbox", "data", "db", "learning-notes"];
const PROTECTED_SEGMENTS = [...SENSITIVE_SEGMENTS, ...USER_DATA_SEGMENTS, ".git", ".pi"];
const BLOCKED_BASH = /\b(codex|curl|wget|ssh|scp|nc|sudo|rm|mv|chmod|chown|git\s+(commit|push|reset|clean)|npm\s+(install|publish)|pnpm\s+(install|add)|yarn\s+(add|install))\b|[;&|`]|\$\(/i;
const ALLOWED_BASH = /^(npm run (lint|typecheck|test(?::integration)?|eval|smoke:mock|verify|start -- .+)|npx vitest run(?: [\w./:-]+)?|git (status|diff)(?: -- [\w./-]+)?|(?:rg|find|ls)(?: [\w./:*?-]+)?)$/;

function hasProtectedSegment(target: string, segments: readonly string[]): boolean {
  const normalized = target.replaceAll("\\", "/").toLowerCase();
  return segments.some((segment) => normalized.split("/").includes(segment.toLowerCase()));
}

function isWithinProject(target: string, cwd: string): boolean {
  const absolute = resolve(cwd, target);
  const outside = relative(cwd, absolute);
  return !isAbsolute(outside) && outside !== ".." && !outside.startsWith(`..${sep}`);
}

async function audit(cwd: string, action: string, detail: string): Promise<void> {
  try {
    const directory = resolve(cwd, "data", "audit");
    await mkdir(directory, { recursive: true });
    // Only record rule names and tool names; never retain blocked arguments or secrets.
    await appendFile(resolve(directory, "pi-guard.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), action, detail })}\n`, "utf8");
  } catch {
    // Guard failures must not turn a denied operation into an allowed operation.
  }
}

function bashBlockReason(command: string): string | undefined {
  if (BLOCKED_BASH.test(command)) return "守卫禁止危险、外发、凭证或 codex CLI 命令；请使用 Pi 原生 Provider。";
  if (!ALLOWED_BASH.test(command)) return "守卫只允许项目验证命令和只读检查命令。";
  return undefined;
}

/** Enforces project-local boundaries independently of model compliance. */
export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash") {
      const reason = bashBlockReason(String(event.input.command ?? ""));
      if (reason) {
        await audit(ctx.cwd, "blocked_bash", "bash policy");
        return { block: true, reason };
      }
      return undefined;
    }

    const target = typeof event.input.path === "string" ? event.input.path : undefined;
    if (!target) return undefined;
    const writing = event.toolName === "write" || event.toolName === "edit";
    const protectedPath = hasProtectedSegment(target, writing ? PROTECTED_SEGMENTS : [...SENSITIVE_SEGMENTS, ...USER_DATA_SEGMENTS]);
    if (!isWithinProject(target, ctx.cwd) || protectedPath) {
      const reason = writing ? "守卫禁止写入项目外或受保护路径。" : "守卫禁止读取敏感或项目外路径。";
      await audit(ctx.cwd, writing ? "blocked_write" : "blocked_read", "path policy");
      if (ctx.hasUI) ctx.ui.notify(reason, "warning");
      return { block: true, reason };
    }
    return undefined;
  });

  pi.on("user_bash", async (event, ctx) => {
    const reason = bashBlockReason(event.command);
    if (!reason) return undefined;
    await audit(ctx.cwd, "blocked_user_bash", "bash policy");
    return { result: { output: reason, exitCode: 126, cancelled: false, truncated: false } };
  });
}
