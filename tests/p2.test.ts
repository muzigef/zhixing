import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { HashEmbeddingModel } from "../src/embedding.js";
import { LocalSandbox } from "../src/local-sandbox.js";
import { ZhixingDatabase } from "../src/database.js";
import { DocumentLibrary } from "../src/library.js";
import { PathPolicy } from "../src/paths.js";
import type { OcrEngine } from "../src/ocr.js";
import { isLoopbackAddress, LocalSyncServer } from "../src/sync-server.js";

const roots: string[] = [];
async function fixture(): Promise<{ root: string; db: ZhixingDatabase; library: DocumentLibrary }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-p2-")); roots.push(root);
  const db = new ZhixingDatabase(path.join(root, "zhixing", "db", "zhixing.sqlite"));
  const ocr: OcrEngine = { extract: async () => [{ page: 1, text: "OCR 本地识别出的 RAG 资料", confidence: 53 }] };
  return { root, db, library: new DocumentLibrary(db, new PathPolicy(root), {}, new HashEmbeddingModel(), ocr) };
}
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

describe("P2 local capabilities", () => {
  it("将扫描 PDF 的本地 OCR 内容索引并标记低置信度", async () => {
    const { db, library } = await fixture();
    const source = path.join(import.meta.dirname, "fixtures", "documents", "scanned.pdf");
    const result = await library.importFile("rag", source);
    expect(result).toMatchObject({ status: "ocr_low_confidence", chunks: 1 });
    expect(library.search("rag", "本地识别")[0]?.citation.pageNumber).toBe(1);
    db.close();
  });

  it("使用本地向量兼容表融合词法与语义结果且不跨主题", async () => {
    const { root, db, library } = await fixture();
    const source = path.join(root, "rag.md");
    await fs.writeFile(source, "# 检索\n\n向量检索会为语义相近的问题返回证据。", "utf8");
    await library.importFile("rag", source);
    expect((db.db.prepare("SELECT count(*) AS count FROM chunk_embeddings").get() as { count: number }).count).toBeGreaterThan(0);
    expect(library.search("rag", "向量检索")[0]?.citation.topicId).toBe("rag");
    expect(library.search("tool-calling", "向量检索")).toEqual([]);
    db.close();
  });

  it("受限执行拒绝未允许命令，并在系统不支持时安全降级", async () => {
    const sandbox = new LocalSandbox("missing-sandbox-exec");
    await expect(sandbox.run(process.execPath, ["--version"], { allowedCommands: [] })).rejects.toThrow("sandbox_command_denied");
    await expect(sandbox.run(process.execPath, ["--version"], { allowedCommands: [process.execPath] })).resolves.toMatchObject({ status: "unavailable" });
  });

  it("真实 sandbox-exec 不允许读取临时目录之外的文件", async () => {
    const result = await new LocalSandbox().run("/bin/cat", ["/etc/hosts"], { allowedCommands: ["/bin/cat"] });
    expect(result.status).toBe("completed");
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).not.toContain("localhost");
  });

  it("同步服务仅接受 loopback 客户端", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    expect(isLoopbackAddress("192.168.1.2")).toBe(false);
  });

  it("同步服务只暴露已注册主题，并向 SSE 订阅者发布进度事件", async () => {
    const server = new LocalSyncServer(async (topicId) => ({ topicId, completed: 1 }), ["rag"]);
    const port = await server.listen();
    try {
      const unknown = await request(`http://127.0.0.1:${port}/topics/not-real/progress`);
      expect(unknown.status).toBe(404);
      const received = await new Promise<string>((resolve, reject) => {
        const subscription = http.get(`http://127.0.0.1:${port}/topics/rag/events`, (response) => {
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => { if (chunk.includes("event: progress")) { response.destroy(); resolve(chunk); } });
        });
        subscription.on("error", reject);
        setTimeout(() => { subscription.destroy(); reject(new Error("sse_timeout")); }, 2_000);
        setTimeout(() => server.publish({ topicId: "rag", type: "progress", payload: { completed: 1 } }), 50);
      });
      expect(received).toContain('"completed":1');
    } finally { await server.close(); }
  });
});

async function request(url: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => http.get(url, (response) => { let body = ""; response.setEncoding("utf8"); response.on("data", (chunk: string) => { body += chunk; }); response.on("end", () => resolve({ status: response.statusCode ?? 0, body })); }).on("error", reject));
}
