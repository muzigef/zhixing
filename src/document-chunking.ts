export const DOCUMENT_CHUNKER_VERSION = "structure-v1";
const linesOf = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
const fenceOf = (line: string) => /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
const closes = (line: string, fence: string) => {
  const token = fenceOf(line);
  return Boolean(token && token[0] === fence[0] && token.length >= fence.length && line.trim() === token);
};
const mathLine = (line: string) => /^\s*\$\$\s*$/.test(line);
const tableRule = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*\|\s*:?-{3,}/.test(line);

/** Heading anchors follow Markdown block boundaries, not headings quoted in code/math. */
export function splitMarkdownSections(source: string): { text: string; page: null; anchor: string }[] {
  const sections: { text: string; page: null; anchor: string }[] = [];
  let text = "", anchor = "root", fence: string | undefined, math = false;
  for (const line of linesOf(source)) {
    const heading = !fence && !math ? /^ {0,3}#{1,6}\s+(.+?)\s*\r?\n?$/.exec(line)?.[1] : undefined;
    if (heading) { if (text) sections.push({ text, page: null, anchor }); text = ""; anchor = heading.slice(0, 1000).replace(/[\uD800-\uDBFF]$/, ""); }
    text += line;
    if (fence) { if (closes(line, fence)) fence = undefined; }
    else if (math) { if (mathLine(line)) math = false; }
    else if (fenceOf(line)) fence = fenceOf(line);
    else if (mathLine(line)) math = true;
  }
  if (text) sections.push({ text, page: null, anchor });
  return sections;
}

/** Preserve bounded structural blocks and nearby conditions; never add or repeat source bytes. */
export function chunkDocumentText(text: string, limit = 1000): string[] { return chunkDocumentParts(text, limit).map(part => part.text); }
export interface DocumentPart { text: string; start: number; end: number; contextStarts: number[]; }
export function relatedPartIndexes(parts: readonly DocumentPart[], part: DocumentPart): number[] {
  return [...new Set(part.contextStarts.flatMap(offset => {
    let low = 0, high = parts.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2), candidate = parts[mid]!;
      if (offset < candidate.start) high = mid - 1;
      else if (offset >= candidate.end) low = mid + 1;
      else return candidate === part ? [] : [mid];
    }
    return [];
  }))].slice(0, 2);
}
export function chunkDocumentParts(text: string, limit = 1000): DocumentPart[] {
  if (!Number.isSafeInteger(limit) || limit < 32 || limit > 4000) throw new Error("chunk_limit_invalid");
  const lines = linesOf(text), blocks: { text: string; structural: boolean; start: number; contextStarts: number[] }[] = [];
  let cursor = 0;
  const tableAt = (index: number) => Boolean(lines[index]?.includes("|") && tableRule(lines[index + 1] ?? ""));
  for (let index = 0; index < lines.length;) {
    if (!lines[index]!.trim() && blocks.length) { const line = lines[index++]!; blocks.at(-1)!.text += line; cursor += line.length; continue; }
    const start = index, fence = fenceOf(lines[index]!), math = mathLine(lines[index]!);
    const table = tableAt(index); index++;
    if (fence || math) {
      while (index < lines.length) { const line = lines[index++]!; if (fence ? closes(line, fence) : mathLine(line)) break; }
    } else if (table) {
      while (index < lines.length && lines[index]!.trim() && lines[index]!.includes("|")) index++;
    } else {
      while (index < lines.length && lines[index]!.trim() && !fenceOf(lines[index]!) && !mathLine(lines[index]!) && !tableAt(index)) index++;
    }
    const block = { text: lines.slice(start, index).join(""), structural: Boolean(fence || math || table), start: cursor, contextStarts: [] as number[] }; cursor += block.text.length;
    const prior = blocks.at(-1);
    if (block.structural && prior && !prior.structural && prior.text.length <= 300 && prior.text.length + block.text.length <= limit) { prior.text += block.text; prior.structural = true; }
    else { if (block.structural && prior && !prior.structural && prior.text.length <= 300) block.contextStarts.push(prior.start); blocks.push(block); }
  }
  const chunks: DocumentPart[] = []; let current: DocumentPart | undefined;
  const append = (text: string, start: number, contextStarts: number[]) => {
    if (current && current.text.length + text.length > limit) { chunks.push(current); current = undefined; }
    current ??= { text: "", start, end: start, contextStarts: [] };
    current.text += text; current.end = start + text.length;
    current.contextStarts = [...new Set([...current.contextStarts, ...contextStarts])];
  };
  for (const block of blocks) {
    const contextStarts = block.structural ? [block.start, ...block.contextStarts] : [];
    if (block.text.length <= limit) { append(block.text, block.start, contextStarts); continue; }
    for (let start = 0; start < block.text.length;) {
      let end = Math.min(start + limit, block.text.length);
      if (end < block.text.length) {
        const newline = block.text.lastIndexOf("\n", end - 1);
        if (newline > start + (block.structural ? 0 : Math.floor(limit / 2))) end = newline + 1;
        if (/[\uD800-\uDBFF]/.test(block.text[end - 1]!)) end--;
      }
      append(block.text.slice(start, end), block.start + start, contextStarts); start = end;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
