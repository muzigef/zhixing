import fs from "node:fs/promises";
import crypto from "node:crypto";
import { z } from "zod";
import { PathPolicy } from "./paths.js";
import type { EvidenceInput } from "./reviewer.js";
import type { SandboxResult } from "./local-sandbox.js";

export const evidenceKindSchema = z.enum(["implementation", "testOutput", "failureCase", "reflection", "testScript"]);
export type EvidenceKind = z.infer<typeof evidenceKindSchema>;
export const dayIdSchema = z.string().regex(/^D[0-9]{2}$/);
const artifactSchema = z.object({ id: z.string().uuid(), kind: evidenceKindSchema, hash: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive().max(256_000), createdAt: z.string().datetime() });
export type EvidenceArtifact = z.infer<typeof artifactSchema> & { intact: boolean };
export type EvidenceValidation = SandboxResult & { id: string; implementationHash: string; testHash: string; createdAt: string };
export interface EvidenceSnapshot { artifacts: EvidenceArtifact[]; validation?: EvidenceValidation; checks: EvidenceInput; }
const validationSchema = z.object({ id: z.string().uuid(), implementationHash: z.string().regex(/^[a-f0-9]{64}$/), testHash: z.string().regex(/^[a-f0-9]{64}$/), createdAt: z.string().datetime(), status: z.enum(["completed", "timed_out", "unavailable", "cancelled"]), stdout: z.string().max(65536), stderr: z.string().max(65536), exitCode: z.number().int().nullable() });
const hash = (text: string) => crypto.createHash("sha256").update(text).digest("hex");

/** Append-only artifact records; reviews re-read owned bytes instead of trusting UI flags. */
export class EvidenceStore {
  constructor(private readonly paths: PathPolicy) {}
  private file(topic: string, day: string, name: string) { return this.paths.resolveTopicPath(topic, "notes", "evidence", dayIdSchema.parse(day), name); }
  async submit(topic: string, day: string, kind: EvidenceKind, text: string): Promise<EvidenceArtifact> {
    evidenceKindSchema.parse(kind);
    if (text.trim().length < 8 || Buffer.byteLength(text) > 256_000) throw new Error("evidence_size_limit");
    const current = await this.list(topic, day);
    if (current.artifacts.length >= 100) throw new Error("evidence_limit");
    const value = artifactSchema.parse({ id: crypto.randomUUID(), kind, hash: hash(text), bytes: Buffer.byteLength(text), createdAt: new Date(Math.max(Date.now(), Date.parse(current.artifacts.at(-1)?.createdAt ?? "1970-01-01") + 1)).toISOString() });
    await fs.mkdir(this.file(topic, day, "."), { recursive: true, mode: 0o700 });
    await fs.writeFile(this.file(topic, day, `${value.id}.txt`), text, { flag: "wx", mode: 0o600 });
    await fs.writeFile(this.file(topic, day, `${value.id}.json`), JSON.stringify(value), { flag: "wx", mode: 0o600 });
    return { ...value, intact: true };
  }
  async list(topic: string, day: string): Promise<EvidenceSnapshot> {
    let names: string[];
    try { names = await fs.readdir(this.file(topic, day, ".")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { artifacts: [], checks: { implementation: false, testOutput: false, failureCase: false, reflection: false } }; throw error; }
    const artifacts: EvidenceArtifact[] = [];
    for (const name of names.filter((name) => /^[0-9a-f-]{36}\.json$/.test(name)).slice(0, 100)) {
      const value = artifactSchema.parse(await this.readJson(this.file(topic, day, name), 4096));
      if (`${value.id}.json` !== name) throw new Error("evidence_invalid");
      let intact = false;
      try { intact = hash(await this.readText(topic, day, value.id)) === value.hash; } catch { /* Missing or edited bytes are never valid evidence. */ }
      artifacts.push({ ...value, intact });
    }
    artifacts.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const latest = (kind: EvidenceKind) => artifacts.findLast((item) => item.kind === kind);
    let validation: EvidenceValidation | undefined;
    const reports = names.filter((name) => /^run-[0-9a-f-]{36}\.json$/.test(name));
    for (const name of reports.slice(-100)) {
      const item = validationSchema.parse(await this.readJson(this.file(topic, day, name), 800_000));
      if (!validation || item.createdAt > validation.createdAt) validation = item;
    }
    if (validation && (validation.implementationHash !== latest("implementation")?.hash || validation.testHash !== latest("testScript")?.hash || !latest("implementation")?.intact || !latest("testScript")?.intact)) validation = undefined;
    const ran = validation?.status === "completed" && validation.exitCode === 0;
    const checks = { implementation: !!latest("implementation")?.intact, testOutput: validation ? !!ran : !!latest("testOutput")?.intact, failureCase: !!latest("failureCase")?.intact, reflection: !!latest("reflection")?.intact };
    return { artifacts, ...(validation ? { validation } : {}), checks };
  }
  async content(topic: string, day: string, id: string): Promise<string> {
    const artifact = (await this.list(topic, day)).artifacts.find((item) => item.id === id && item.intact);
    if (!artifact) throw new Error("evidence_invalid");
    const text = await this.readText(topic, day, id);
    if (hash(text) !== artifact.hash) throw new Error("evidence_invalid");
    return text;
  }
  async recordValidation(topic: string, day: string, value: EvidenceValidation) {
    const item = validationSchema.parse(value);
    await fs.writeFile(this.file(topic, day, `run-${item.id}.json`), JSON.stringify(item), { flag: "wx", mode: 0o600 });
  }
  private async readText(topic: string, day: string, id: string) { const file = this.file(topic, day, `${z.string().uuid().parse(id)}.txt`); if ((await fs.stat(file)).size > 256_000) throw new Error("evidence_size_limit"); return fs.readFile(file, "utf8"); }
  private async readJson(file: string, max: number): Promise<unknown> { if ((await fs.stat(file)).size > max) throw new Error("evidence_size_limit"); return JSON.parse(await fs.readFile(file, "utf8")); }
}
