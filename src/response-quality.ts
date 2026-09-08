import { z } from "zod";

export const responseObservationSchema = z.object({
  code: z.enum(["continuation_repeat_removed", "unclosed_code", "unclosed_math", "math_layout", "bare_latex", "unverified_citation", "paragraph_count"]),
  detail: z.string().max(240),
});
export type ResponseObservation = z.infer<typeof responseObservationSchema>;

export function requestedParagraphs(question: string): number | undefined {
  const match = question.match(/(?<!不要|不必|无需)(?:只写|只用|仅写|仅用|请用|用|分成|分为)\s*([两二三四五2-5])\s*(?:个)?段(?:落)?/);
  return match ? ({ 两: 2, 二: 2, 三: 3, 四: 4, 五: 5 } as Record<string, number>)[match[1]!] ?? Number(match[1]) : undefined;
}
export function turnResponseRules(question: string): string {
  const rules: string[] = []; const paragraphs = requestedParagraphs(question);
  if (paragraphs) rules.push(`本轮格式要求：恰好 ${paragraphs} 段正文，不添加标题、列表、独立开场或总结。发送前检查段数。`);
  if (/^继续(?:回答|讲解|上次被打断的回答)?[。.!！]?$/i.test(question.trim())) rules.push("本轮是衔接最近回答：不要从第一个步骤重新开始，不复述已展示的段落。第一句直接进入尚未讲完的部分；只补剩余内容。");
  return rules.join("\n");
}

/** Presentation-only exact overlap filter. Never edits code/math or canonical provider turns. */
export class ContinuationText {
  private buffer = "";
  private decided: boolean;
  removed = 0;
  constructor(private readonly previous = "") {
    this.decided = previous.length < 40 || previous.length > 6000 || /[`$]|\\(?:frac|partial|sum|sqrt|begin)/.test(previous);
  }
  push(text: string): string {
    if (this.decided) return text;
    this.buffer += text;
    if (this.previous.startsWith(this.buffer)) return "";
    this.decided = true;
    if (this.buffer.startsWith(this.previous)) { this.removed = this.previous.length; this.buffer = this.buffer.slice(this.removed); }
    return this.finish();
  }
  finish(): string { const text = this.buffer; this.buffer = ""; this.decided = true; return text; }
  clean(text: string): string { return this.removed && text.startsWith(this.previous) ? text.slice(this.removed) : text; }
}

/** Observable warnings, never correctness scores or automatic rewrites. */
export function inspectResponse(text: string, question: string, verifiedCitations: readonly string[]): ResponseObservation[] {
  const result: ResponseObservation[] = [];
  const add = (code: ResponseObservation["code"], detail: string) => result.push({ code, detail });
  const fences = text.match(/^\s*(`{3,}|~{3,}).*$/gm) ?? [];
  if (fences.length % 2) add("unclosed_code", "检测到代码围栏可能未闭合，可要求补全代码块。");
  const prose = text.replace(/(^|\n)\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\s*\2(?=\s|$)|$)/g, "").replace(/`[^`\n]*`/g, "");
  if ((prose.match(/\$\$/g) ?? []).length % 2) add("unclosed_math", "检测到公式块可能未闭合，可要求补全公式定界符。");
  if (prose.split("\n").some(line => line.includes("$$") && line.trim() !== "$$")) add("math_layout", "检测到公式块定界符与正文同行，可要求将开闭 $$ 各放在独立一行。");
  const plain = prose.replace(/\$\$[\s\S]*?\$\$/g, "").replace(/(?<!\\)\$[^$\n]+\$/g, "");
  if (/\\(?:frac|partial|sum|sqrt|begin)\b/.test(plain)) add("bare_latex", "检测到数学命令缺少公式定界符，可要求按 Markdown + LaTeX 排版。");
  const markers = prose.match(/\[(?:[^\]\n]+#(?:anchor|page)=[^\]\n]+|(?:来源\s*)?\d+)\](?!\()/g) ?? [];
  if (markers.some(marker => !verifiedCitations.includes(marker))) add("unverified_citation", "回答包含未匹配到受控资料的引用标记。请打开来源核对，或要求提供依据。");
  const count = requestedParagraphs(question);
  if (count) {
    if (text.trim().split(/\n\s*\n/).filter(Boolean).length !== count) add("paragraph_count", `回答的段落块数量与本轮要求的 ${count} 段可能不一致，可要求按原内容调整格式。`);
  }
  return result;
}

/** Only complete, whole-line display wrappers are reformatted; formula bytes are preserved. */
export function normalizeDisplayMath(text: string): string {
  let fence: string | undefined; let math = false;
  const normalized = text.split("\n").map(line => {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) { if (!fence) fence = marker[1]; else if (marker[1]![0] === fence[0] && marker[1]!.length >= fence.length) fence = undefined; return line; }
    if (fence) return line;
    if (line.trim() === "$$") { math = !math; return line; }
    if (math) return line;
    const whole = line.match(/^\s*\$\$([^\n]+?)\$\$\s*$/);
    return whole && !whole[1]!.includes("$$") ? `$$\n${whole[1]}\n$$` : line;
  }).join("\n");
  return normalized.length <= 64_000 ? normalized : text;
}
export function responseRepairReason(text: string, question: string): string | undefined {
  if (/^继续(?:回答|讲解|上次被打断的回答)?[。.!！]?$/i.test(question.trim()) && /^(?:continue|继续|好的|ok)[。.!！]?$/i.test(text.trim())) return "本轮没有实质回答。请根据已有上下文直接补充尚未讲完的内容，不要只返回继续/continue。";
  const paragraphs = requestedParagraphs(question);
  if (paragraphs && !/[`$]/.test(text) && text.trim().split(/\n\s*\n/).filter(Boolean).length !== paragraphs) return `本轮要求恰好 ${paragraphs} 段正文。请保留关键内容，修正段落数并移除标题、开场和总结。`;
  return undefined;
}
