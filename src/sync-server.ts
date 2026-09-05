import http, { type ServerResponse } from "node:http";
import type { TopicId } from "./contracts.js";
import { topicIdSchema } from "./contracts.js";

type SyncEvent = { topicId: TopicId; type: "progress" | "library"; payload: unknown };

/** Loopback-only SSE contract. Events and reads are always scoped to one validated topic. */
export class LocalSyncServer {
  #server?: http.Server; #clients = new Map<TopicId, Set<ServerResponse>>();
  constructor(private readonly progress: (topicId: TopicId) => Promise<unknown>, private readonly validTopics: readonly TopicId[]) {}
  async listen(port = 0): Promise<number> {
    this.#server = http.createServer(async (request, response) => {
      const match = /^\/topics\/([a-z0-9][a-z0-9-]*)\/(progress|events)$/.exec(request.url ?? "");
      if (!match || !isLoopbackAddress(request.socket.remoteAddress)) { response.writeHead(404).end(); return; }
      const parsed = topicIdSchema.safeParse(match[1]);
      if (!parsed.success) { response.writeHead(404).end(); return; }
      const topicId = parsed.data;
      if (!this.validTopics.includes(topicId)) { response.writeHead(404).end(); return; }
      if (match[2] === "progress" && request.method === "GET") {
        try { const progress = await this.progress(topicId); response.writeHead(200, { "content-type": "application/json" }); response.end(JSON.stringify(progress)); }
        catch { response.writeHead(500).end(JSON.stringify({ error: "progress_unavailable" })); }
        return;
      }
      if (match[2] !== "events" || request.method !== "GET") { response.writeHead(405).end(); return; }
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      response.write(`event: ready\ndata: ${JSON.stringify({ topicId })}\n\n`);
      const clients = this.#clients.get(topicId) ?? new Set<ServerResponse>(); clients.add(response); this.#clients.set(topicId, clients);
      request.on("close", () => clients.delete(response));
    });
    await new Promise<void>((resolve, reject) => { this.#server?.once("error", reject); this.#server?.listen(port, "127.0.0.1", () => { this.#server?.off("error", reject); resolve(); }); });
    return (this.#server.address() as { port: number }).port;
  }
  publish(event: SyncEvent): void { for (const client of this.#clients.get(event.topicId) ?? []) client.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`); }
  async close(): Promise<void> { if (this.#server) await new Promise<void>((resolve, reject) => this.#server?.close((error) => error ? reject(error) : resolve())); }
}

export function isLoopbackAddress(address: string | undefined): boolean { return Boolean(address?.match(/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/)); }
