import { hostProcess } from "./process-gateway.js";
const { execFile } = hostProcess("ocr");
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const environment = () => ({ PATH: process.platform === "win32" ? process.env.PATH : "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin", ...(process.platform === "win32" ? { SystemRoot: process.env.SystemRoot } : {}) });

export type OcrPage = { page: number; text: string; confidence: number };
export interface OcrEngine { extract(pdfFile: string, signal?: AbortSignal, options?: { pages: readonly number[] }): Promise<readonly OcrPage[]>; }

/** Local-only PDF OCR. It never sends document bytes to a provider. */
export class TesseractOcrEngine implements OcrEngine {
  constructor(private readonly commands = { pdftoppm: "pdftoppm", tesseract: "tesseract" }) {}

  async extract(pdfFile: string, signal?: AbortSignal, options?: { pages: readonly number[] }): Promise<readonly OcrPage[]> {
    if (options && (options.pages.length > 500 || options.pages.some(page => !Number.isInteger(page) || page < 1 || page > 500) || new Set(options.pages).size !== options.pages.length)) throw new Error("ocr_pages_invalid");
    if (options && !options.pages.length) return [];
    signal = signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000);
    signal?.throwIfAborted();
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-ocr-"));
    try {
      const prefix = path.join(directory, "page");
      const pages: OcrPage[] = [];
      for (const page of options ? [...options.pages].sort((a, b) => a - b) : [undefined]) {
        signal.throwIfAborted();
        await run(this.commands.pdftoppm, ["-png", "-r", "180", ...(page === undefined ? [] : ["-f", String(page), "-l", String(page)]), pdfFile, prefix], { maxBuffer: 8 * 1024 * 1024, timeout: 30_000, signal, env: environment() });
        const images = (await fs.readdir(directory)).filter((name) => /^page-\d+\.png$/.test(name)).sort((left, right) => pageNumber(left) - pageNumber(right));
        for (const image of images) {
          signal.throwIfAborted();
          if (page !== undefined && pageNumber(image) !== page) throw new Error("ocr_page_mismatch");
          const imageFile = path.join(directory, image);
          const { stdout } = await run(this.commands.tesseract, [imageFile, "stdout", "--psm", "3", "tsv"], { maxBuffer: 8 * 1024 * 1024, timeout: 30_000, signal, env: environment() });
          pages.push(parseTsv(stdout, pageNumber(image))); await fs.rm(imageFile);
        }
      }
      return pages.filter((page) => page.text.trim());
    } finally { await fs.rm(directory, { recursive: true, force: true }); }
  }
}

function pageNumber(file: string): number { return Number(/^page-(\d+)\.png$/.exec(file)?.[1] ?? 0); }

function parseTsv(tsv: string, page: number): OcrPage {
  const words = tsv.split("\n").slice(1).map((line) => line.split("\t")).filter((columns) => columns.length >= 12 && columns[11]?.trim());
  const confidences = words.map((columns) => Number(columns[10])).filter((value) => Number.isFinite(value) && value >= 0);
  return { page, text: words.map((columns) => columns[11]).join(" "), confidence: confidences.length ? confidences.reduce((total, value) => total + value, 0) / confidences.length : 0 };
}
