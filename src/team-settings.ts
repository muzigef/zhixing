import { atomicJson, readJson } from "./agent-session-store.js";
import { teamConfigurationSchema, type TeamConfiguration } from "./team-contracts.js";
export class TeamSettings {
  constructor(private file: string) {}
  async load(): Promise<TeamConfiguration> {
    try { return teamConfigurationSchema.parse(await readJson(this.file, 8000)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return teamConfigurationSchema.parse({}); throw error; }
  }
  async save(value: unknown): Promise<TeamConfiguration> { const config = teamConfigurationSchema.parse(value); await atomicJson(this.file, config, 8000); return config; }
}
