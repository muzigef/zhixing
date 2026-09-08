import path from "node:path";
import { z } from "zod/v4";
import { settingsSchema, type DesktopSettings } from "./contracts.js";
import { AgentSessionStore, readJson, atomicJson } from "../../src/agent-session-store.js";
/** Desktop preferences stay in the transport adapter; conversations use the shared store. */
export class DesktopStore extends AgentSessionStore {
  private preferenceWrites: Promise<void> = Promise.resolve();
  async settings(): Promise<DesktopSettings> {
    // IPC handlers overlap. A boot/read after a submitted save must not observe
    // the old file while its atomic rename is still queued.
    await this.preferenceWrites.catch(() => undefined); // Save callers receive errors; reads can recover the last committed file.
    try {
      return settingsSchema.parse(
        await readJson(path.join(this.root, "preferences.json"), 16_000),
      );
    } catch (error) {
      if (isMissing(error)) return settingsSchema.parse({});
      throw new Error("settings_invalid");
    }
  }
  async saveSettings(settings: DesktopSettings): Promise<void> {
    const checked = settingsSchema.parse(settings);
    this.preferenceWrites = this.preferenceWrites
      .catch(() => undefined)
      .then(() =>
        atomicJson(path.join(this.root, "preferences.json"), checked, 16_000),
      );
    await this.preferenceWrites;
  }
  override async flush(): Promise<void> { await this.preferenceWrites; await super.flush(); }
  async workspace(): Promise<string | undefined> {
    try { return z.object({ path: z.string().min(1).max(4096) }).parse(await readJson(path.join(this.root, "workspace.json"), 20_000)).path; }
    catch (error) { if (isMissing(error)) return undefined; throw new Error("workspace_invalid"); }
  }
  async saveWorkspace(workspace: string): Promise<void> {
    await atomicJson(path.join(this.root, "workspace.json"), { path: workspace }, 20_000);
  }
}
function isMissing(error: unknown): boolean { return (error as NodeJS.ErrnoException).code === "ENOENT"; }
