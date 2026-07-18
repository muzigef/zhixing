import fs from "node:fs/promises";
import path from "node:path";
import type { ModelRole } from "./model.js";
import { ProviderRegistry } from "./provider-registry.js";

const ROLES: readonly ModelRole[] = ["tutor", "reviewer", "lab"];

/** Persists only non-sensitive role routing, never provider credentials. */
export class ModelRoutingStore {
  constructor(private readonly file: string) {}

  async load(registry: ProviderRegistry): Promise<void> {
    let value: unknown;
    try { value = JSON.parse(await fs.readFile(this.file, "utf8")); } catch { return; }
    if (!value || typeof value !== "object") return;
    const routes = (value as { routes?: unknown }).routes;
    if (!routes || typeof routes !== "object") return;
    for (const role of ROLES) {
      const provider = (routes as Record<string, unknown>)[role];
      if (typeof provider !== "string" || !registry.providerIds().includes(provider)) continue;
      registry.route(role, provider);
    }
  }

  async save(registry: ProviderRegistry): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const routes = Object.fromEntries(ROLES.flatMap((role) => {
      const provider = registry.routedProvider(role);
      return provider ? [[role, provider]] : [];
    }));
    const temporary = `${this.file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify({ routes }, null, 2)}\n`, "utf8");
    await fs.rename(temporary, this.file);
  }
}
