import type { Readable, Writable } from "node:stream";
import type { SandboxPolicy, SandboxPolicyInput, SandboxCapabilities } from "./sandbox-policy.js";
export type SandboxLimit = "memory" | "cpu" | "output" | "workspace";
export type SandboxResult = { status: "completed" | "timed_out" | "unavailable" | "cancelled" | "resource_limited"; stdout: string; stderr: string; exitCode: number | null; limit?: SandboxLimit; policyId?: string; backend?: string };
export type SandboxOptions = { timeoutMs?: number; allowedCommands?: readonly string[]; files?: Readonly<Record<string, string>>; signal?: AbortSignal; runtimeReadPath?: string; readPaths?: readonly string[]; electronNode?: boolean; policy?: SandboxPolicyInput };
export type SandboxSession = { directory: string; stdin: Writable; stdout: Readable; stderr: Readable; completion: Promise<SandboxResult>; stop: () => void; dispose: () => Promise<void> };
export type SandboxRequest = { command: string; args: readonly string[]; policy: SandboxPolicy; options: SandboxOptions; interactive: boolean };
export interface SandboxBackend { readonly id: string; readonly capabilities: SandboxCapabilities; open(request: SandboxRequest): Promise<SandboxSession>; run?(request: SandboxRequest): Promise<SandboxResult>; }
