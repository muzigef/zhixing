import { createHash } from "node:crypto";
import { z } from "zod/v4";

/** Host-owned policy. Models cannot select a backend or relax these grants. */
const policySchema = z.object({
  version: z.literal(1).default(1), network: z.literal("deny").default("deny"), maxProcesses: z.literal(1).default(1),
  timeoutMs: z.number().int().min(1).max(300_000).default(5000),
  cpuSeconds: z.number().int().min(1).max(120).default(5),
  memoryBytes: z.number().int().min(64 * 1024 * 1024).max(1024 * 1024 * 1024).default(512 * 1024 * 1024),
  outputBytes: z.number().int().min(1024).max(2_000_000).default(65536),
  workspaceBytes: z.number().int().min(65536).max(64 * 1024 * 1024).default(16 * 1024 * 1024),
  workspaceFiles: z.number().int().min(1).max(1024).default(256),
  inputBytes: z.number().int().min(1).max(2_000_000).default(2_000_000),
  requireHardMemoryLimit: z.boolean().default(false),
}).strict();
export type SandboxPolicy = Readonly<z.infer<typeof policySchema>>;
export type SandboxPolicyInput = z.input<typeof policySchema>;
export function createSandboxPolicy(input: SandboxPolicyInput = {}): SandboxPolicy { return Object.freeze(policySchema.parse(input)); }
export function sandboxPolicyId(policy: SandboxPolicy): string { return createHash("sha256").update(JSON.stringify(policy)).digest("hex"); }
export type SandboxCapabilities = { memory: "hard" | "monitored"; interactive: boolean };
export function assertSandboxCapabilities(policy: SandboxPolicy, capabilities: SandboxCapabilities, interactive: boolean): void {
  if (policy.requireHardMemoryLimit && capabilities.memory !== "hard" || interactive && !capabilities.interactive) throw new Error("sandbox_capability_unavailable");
}
export function validateSandboxInputs(files: Readonly<Record<string, string>>, policy: SandboxPolicy): void {
  let bytes = 0; const names = new Set<string>();
  if (Object.keys(files).length > policy.workspaceFiles) throw new Error("sandbox_input_limit");
  for (const [name, content] of Object.entries(files)) {
    const parts = name.split("/");
    if (!/^[a-zA-Z0-9._/-]+$/.test(name) || parts.length > 5 || parts.some(part => !part || part === "." || part === ".." || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part) || /[. ]$/.test(part)) || names.has(name.toLowerCase())) throw new Error("sandbox_file_denied");
    names.add(name.toLowerCase()); bytes += Buffer.byteLength(content);
    if (bytes > Math.min(policy.inputBytes, policy.workspaceBytes)) throw new Error("sandbox_input_limit");
  }
  for (const name of names) { const parts = name.split("/"); parts.pop(); while (parts.length) { if (names.has(parts.join("/"))) throw new Error("sandbox_file_denied"); parts.pop(); } }
}
