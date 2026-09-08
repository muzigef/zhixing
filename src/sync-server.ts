import http, { type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { TopicId } from "./contracts.js";
import { topicIdSchema } from "./contracts.js";
type SyncEvent = { topicId: TopicId; type: "progress" | "library"; payload: unknown };

/** Native local clients must possess this process's ephemeral access capability. */
export class LocalSyncServer {
  #server?: http.Server; #clients = new Map<TopicId, Set<ServerResponse>>();
  readonly #key = randomBytes(32).toString("base64url");
  constructor(private readonly progress: (topicId: TopicId) => Promise<unknown>, private readonly validTopics: readonly TopicId[]) {}
  authorizationHeader(): string { return `Bearer ${this.#key}`; }
  async listen(port = 0): Promise<number> {
    if (this.#server || !Number.isInteger(port) || port < 0 || port > 65535) throw new Error("sync_listen_invalid");
    const server = http.createServer({ maxHeaderSize: 4096, requestTimeout: 10_000 }, async (request, response) => {
      const match = /^\/topics\/([a-z0-9][a-z0-9-]*)\/(progress|events)$/.exec(request.url ?? "");
      if (!match || !isLoopbackAddress(request.socket.remoteAddress)) { response.writeHead(404).end(); return; }
      const parsed = topicIdSchema.safeParse(match[1]);
      if (!parsed.success || !this.validTopics.includes(parsed.data)) { response.writeHead(404).end(); return; }
      if (request.headers.origin !== undefined || request.headers.host !== `127.0.0.1:${request.socket.localPort}`) { response.writeHead(403).end(); return; }
      const expected = Buffer.from(this.authorizationHeader()), actual = Buffer.from(request.headers.authorization ?? "");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { response.writeHead(401).end(); return; }
      if (request.method !== "GET") { response.writeHead(405).end(); return; }
      const topicId = parsed.data;
      if (match[2] === "progress") {
        try { const progress = await this.progress(topicId); response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(progress)); }
        catch { response.writeHead(500).end(JSON.stringify({ error: "progress_unavailable" })); }
        return;
      }
      if ([...this.#clients.values()].reduce((count, clients) => count + clients.size, 0) >= 32) { response.writeHead(429).end(); return; }
      response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
      response.write(`event: ready\ndata: ${JSON.stringify({ topicId })}\n\n`);
      const clients = this.#clients.get(topicId) ?? new Set<ServerResponse>(); clients.add(response); this.#clients.set(topicId, clients);
      response.on("close", () => clients.delete(response));
    });
    this.#server = server;
    try { await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); }); }); }
    catch (error) { this.#server = undefined; throw error; }
    return (server.address() as { port: number }).port;
  }
  publish(event: SyncEvent): void {
    if (!this.validTopics.includes(event.topicId) || !["progress", "library"].includes(event.type)) throw new Error("sync_event_invalid");
    const payload = JSON.stringify(event.payload); if (Buffer.byteLength(payload) > 64_000) throw new Error("sync_event_limit");
    for (const client of this.#clients.get(event.topicId) ?? []) {
      if (client.writableLength > 64_000) client.destroy();
      else client.write(`event: ${event.type}\ndata: ${payload}\n\n`);
    }
  }
  async close(): Promise<void> {
    const server = this.#server; this.#server = undefined;
    for (const clients of this.#clients.values()) for (const client of clients) client.end(); this.#clients.clear();
    if (server) await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
  }
}
export function isLoopbackAddress(address: string | undefined): boolean { return Boolean(address?.match(/^(::1|127\.0\.0\.1|::ffff:127\.0\.0\.1)$/)); }
