import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
import { hostProcess } from "../src/process-gateway.js";
import { textPagesPdf, mixedRasterPdf } from "../tests/helpers/pdf-fixture.js";
import { ZhixingDatabase } from "../src/database.js";
import { DocumentLibrary } from "../src/library.js";
import { PathPolicy } from "../src/paths.js";

const root = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-native-ocr-"));
const run = promisify(hostProcess("ocr").execFile);
const signal = AbortSignal.timeout(60_000);
const options = { signal, timeout: 30_000, maxBuffer: 1024 * 1024, env: { PATH: process.env.PATH, ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}) } };
let db: ZhixingDatabase | undefined;
try {
  const source = path.join(root, "public-text.pdf"), raster = path.join(root, "raster");
  await fs.writeFile(source, textPagesPdf(["CACHE CONDITIONS CAN FAIL"]));
  await run("pdftoppm", ["-f", "1", "-l", "1", "-singlefile", "-jpeg", "-scale-to-x", "1200", "-scale-to-y", "1500", source, raster], options);
  const mixed = mixedRasterPdf(await fs.readFile(`${raster}.jpg`), 1200, 1500);
  const file = path.join(root, "mixed.pdf"); await fs.writeFile(file, mixed);
  db = new ZhixingDatabase(path.join(root, "zhixing", "db", "zhixing.sqlite"));
  const library = new DocumentLibrary(db, new PathPolicy(root));
  const started = performance.now(); const imported = await library.importFile("rag", file, signal);
  const elapsedMs = performance.now() - started;
  const hit = library.search("rag", "CACHE CONDITIONS").find(item => item.citation.pageNumber === 2);
  if (imported.status !== "indexed" || imported.extraction?.ocrPages.join(",") !== "2" || imported.extraction.unreadPages.length || !hit?.text.includes("CACHE CONDITIONS CAN FAIL") || hit.citation.extraction?.method !== "ocr") throw new Error("native_ocr_acceptance_failed");
  const version = await run("tesseract", ["--version"], options);
  const poppler = await run("pdftoppm", ["-v"], options);
  process.stdout.write(JSON.stringify({ version: 1, fixture: "public-generated-mixed-text-and-raster", fixtureSha256: createHash("sha256").update(mixed).digest("hex"), platform: `${process.platform}-${process.arch}`, node: process.version, tesseract: String(version.stdout).split("\n")[0], poppler: String(poppler.stderr).split("\n")[0], status: "passed", elapsedMs, imported, recognized: { text: hit.text, page: hit.citation.pageNumber, extraction: hit.citation.extraction }, limitation: "本机真实 OCR 工具链的固定英文扫描页验收，不代表中文、表格、公式或所有真实 PDF 的识别准确率。" }, null, 2) + "\n");
} finally { db?.close(); await fs.rm(root, { recursive: true, force: true }); }
