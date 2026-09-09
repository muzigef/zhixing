import { createHash } from "node:crypto";
import { apiConnectionInputSchema, apiConnectionSchema, apiConnectionsSchema, customProviderSchema, type ApiConnectionInput, type ApiConnection, type ApiConnectionsState, type CustomProvider } from "./api-connection-config.js";
import { readJson, atomicJson } from "./agent-session-store.js";

/** The credential reference is bound to the complete wire configuration, including restored files. */
export function connectionIdentity(input: ApiConnectionInput): CustomProvider {
  const parsed = apiConnectionInputSchema.parse(input);
  const binding = { ...parsed, name: "" };
  return customProviderSchema.parse(`api-${createHash("sha256").update(JSON.stringify(binding)).digest("hex").slice(0, 32)}`);
}
export function checkedConnection(input: ApiConnection): ApiConnection {
  const checked = apiConnectionSchema.safeParse(input);
  if (!checked.success) throw new Error("api_connections_invalid");
  const { id, ...definition } = checked.data;
  if (connectionIdentity(definition) !== id) throw new Error("api_connections_invalid");
  return checked.data;
}
export class ApiConnections {
  private writes: Promise<unknown> = Promise.resolve();
  constructor(private readonly file: string) {}
  async load(): Promise<ApiConnectionsState> { await this.writes.catch(() => undefined); return this.read(); }
  private async read(): Promise<ApiConnectionsState> {
    try {
      const state = apiConnectionsSchema.parse(await readJson(this.file, 64_000));
      for (const connection of state.connections) checkedConnection(connection);
      if (new Set(state.connections.map(item => item.id)).size !== state.connections.length) throw new Error("duplicate");
      return state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, revision: 0, connections: [] };
      throw new Error("api_connections_invalid");
    }
  }
  save(input: ApiConnectionInput, revision: number, beforeCommit?: (connection: ApiConnection) => Promise<void>): Promise<ApiConnectionsState> {
    const parsed = apiConnectionInputSchema.parse(input);
    const connection = { ...parsed, id: connectionIdentity(parsed) };
    return this.mutate(revision, async state => {
      const connections = [...state.connections.filter(item => item.id !== connection.id), connection];
      if (connections.length > 20) throw new Error("api_connections_limit");
      // Commit the encrypted secret first; a failed preference write can leave only an
      // orphaned cipher file, never a live profile with the wrong endpoint/key pair.
      await beforeCommit?.(connection);
      return connections;
    });
  }
  remove(id: string, revision: number): Promise<ApiConnectionsState> {
    const checked = customProviderSchema.parse(id);
    return this.mutate(revision, async state => state.connections.filter(item => item.id !== checked));
  }
  merge(connections: ApiConnection[], revision: number): Promise<ApiConnectionsState> {
    const checked = connections.map(checkedConnection);
    return this.mutate(revision, async state => {
      const merged = new Map(checked.map(item => [item.id, item]));
      // Explicit backup restore adds missing public definitions; current names win.
      for (const item of state.connections) merged.set(item.id, item);
      if (merged.size > 20) throw new Error("api_connections_limit");
      return [...merged.values()];
    });
  }
  private mutate(revision: number, change: (state: ApiConnectionsState) => Promise<ApiConnection[]>): Promise<ApiConnectionsState> {
    const pending = this.writes.catch(() => undefined).then(async () => {
      const current = await this.read();
      if (revision !== current.revision) throw new Error("api_connections_conflict");
      const state = apiConnectionsSchema.parse({ ...current, revision: revision + 1, connections: await change(current) });
      await atomicJson(this.file, state, 64_000); return state;
    });
    this.writes = pending; return pending;
  }
}
