import { z } from "zod/v4";

export const pageExtractionSchema = z.object({ page: z.number().int().min(1).max(500), method: z.enum(["text", "ocr", "unread"]), confidence: z.number().min(0).max(100).optional() }).strict();
export type PageExtraction = z.infer<typeof pageExtractionSchema>;
export const extractionQualitySchema = z.object({ method: z.enum(["text", "ocr"]), confidence: z.number().min(0).max(100).optional(), incompleteDocument: z.boolean() }).strict();
export type ExtractionQuality = z.infer<typeof extractionQualitySchema>;
export function extractionNotice(quality?: ExtractionQuality): string {
  if (!quality) return "";
  return [quality.method === "ocr" ? `OCR 识别置信度 ${quality.confidence === undefined ? "未知" : Number(quality.confidence.toFixed(1))}；识别分数不是事实正确概率，关键数值需对照原页。` : "",
    quality.incompleteDocument ? "部分页面未识别，不能据已有片段概括未识别页面或声称已读完整文档。" : ""].filter(Boolean).join(" ");
}
export function extractionCoverage(pages: readonly PageExtraction[]) {
  return { totalPages: pages.length, ocrPages: pages.filter(p => p.method === "ocr").map(p => p.page), unreadPages: pages.filter(p => p.method === "unread").map(p => p.page), lowConfidencePages: pages.filter(p => p.method === "ocr" && (p.confidence ?? 0) < 70).map(p => p.page) };
}
export const ocrResultSchema = z.array(z.object({ page: z.number().int().min(1).max(500), text: z.string().max(200_000), confidence: z.number().min(0).max(100) }).strict()).max(500).refine(pages => new Set(pages.map(p => p.page)).size === pages.length && pages.reduce((n, p) => n + p.text.length, 0) <= 10_000_000);
