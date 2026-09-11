import { z } from "zod/v4";

/** Reviewed product entries, shared by both hosts and validation. No executable code or secrets. */
export const nativeRuntimeCatalog = [
  { vendor: "codex", provider: "native-codex", label: "官方 Codex", teams: true, pendingReason: "Codex 执行适配未启用。" },
  { vendor: "claude", provider: "native-claude", label: "官方 Claude Code", teams: false, pendingReason: "Claude Code 执行适配未启用。" },
  { vendor: "gemini", provider: "native-gemini", label: "官方 Gemini CLI", teams: false, pendingReason: "Gemini 原生执行适配保留为后续扩展；当前可使用 Gemini API。" },
] as const;
export type NativeVendor = typeof nativeRuntimeCatalog[number]["vendor"];
export const nativeProviderSchema = z.enum(nativeRuntimeCatalog.map(entry => entry.provider));
