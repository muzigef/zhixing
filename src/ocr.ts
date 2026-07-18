import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export type OcrPage = { page: number; text: string; confidence: number };
export interface OcrEngine { extract(pdfFile: string): Promise<readonly OcrPage[]>; }

/** Local-only PDF OCR. It never sends document bytes to a provider. */
export class TesseractOcrEngine implements OcrEngine {
  constructor(private readonly commands = { pdftoppm: "pdftoppm", tesseract: "tesseract" }) {}

  async extract(pdfFile: string): Promise<readonly OcrPage[]> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "zhixing-ocr-"));
    try {
      const prefix = path.join(directory, "page");
      await run(this.commands.pdftoppm, ["-png", "-r", "180", pdfFile, prefix], { maxBuffer: 8 * 1024 * 1024, timeout: 30_000 });
      const images = (await fs.readdir(directory)).filter((name) => /^page-\d+\.png$/.test(name)).sort((left, right) => pageNumber(left) - pageNumber(right));
      const pages = await Promise.all(images.map(async (image, index) => {
        const { stdout } = await run(this.commands.tesseract, [path.join(directory, image), "stdout", "--psm", "3", "tsv"], { maxBuffer: 8 * 1024 * 1024, timeout: 30_000 });
        return parseTsv(stdout, index + 1);
      }));
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
