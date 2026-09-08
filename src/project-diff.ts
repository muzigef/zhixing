/** Bounded line diff: retain common lines, calculate exact edits, show three lines of context. */
export function unifiedDiff(name: string, before: string, after: string): string {
  if (before === after) return "文件内容没有变化。";
  const lines = (text: string) => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const a = lines(before); const b = lines(after); let prefix = 0; let suffix = 0;
  while (prefix < Math.min(a.length, b.length) && a[prefix] === b[prefix]) prefix++;
  while (suffix < Math.min(a.length, b.length) - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  const old = a.slice(prefix, a.length - suffix); const next = b.slice(prefix, b.length - suffix);
  const edits: { mark: string; line: string }[] = a.slice(0, prefix).map(line => ({ mark: " ", line }));
  if (old.length * next.length <= 1_000_000) {
    const width = next.length + 1; const counts = new Uint32Array((old.length + 1) * width);
    for (let i = old.length - 1; i >= 0; i--) for (let j = next.length - 1; j >= 0; j--) counts[i * width + j] = old[i] === next[j] ? counts[(i + 1) * width + j + 1]! + 1 : Math.max(counts[(i + 1) * width + j]!, counts[i * width + j + 1]!);
    let i = 0; let j = 0;
    while (i < old.length || j < next.length) {
      if (i < old.length && j < next.length && old[i] === next[j]) { edits.push({ mark: " ", line: old[i++]! }); j++; }
      else if (i < old.length && (j >= next.length || counts[(i + 1) * width + j]! >= counts[i * width + j + 1]!)) edits.push({ mark: "-", line: old[i++]! });
      else edits.push({ mark: "+", line: next[j++]! });
    }
  } else { edits.push(...old.map(line => ({ mark: "-", line })), ...next.map(line => ({ mark: "+", line }))); }
  edits.push(...a.slice(a.length - suffix).map(line => ({ mark: " ", line })));
  const ranges: { start: number; end: number }[] = [];
  edits.forEach((edit, i) => { if (edit.mark === " ") return; const start = Math.max(0, i - 3); const end = Math.min(edits.length, i + 4); const last = ranges.at(-1); if (last && start <= last.end) last.end = end; else ranges.push({ start, end }); });
  const output = [`--- a/${name}`, `+++ b/${name}`]; let oldLine = 1; let newLine = 1; let cursor = 0;
  for (const range of ranges) {
    while (cursor < range.start) { const item = edits[cursor++]!; if (item.mark !== "+") oldLine++; if (item.mark !== "-") newLine++; }
    const items = edits.slice(range.start, range.end); const oldCount = items.filter(item => item.mark !== "+").length; const newCount = items.filter(item => item.mark !== "-").length;
    output.push(`@@ -${oldCount ? oldLine : oldLine - 1},${oldCount} +${newCount ? newLine : newLine - 1},${newCount} @@`);
    for (const item of items) { output.push(`${item.mark}${item.line.replace(/\n$/, "")}`); if (!item.line.endsWith("\n")) output.push("\\ No newline at end of file"); if (item.mark !== "+") oldLine++; if (item.mark !== "-") newLine++; cursor++; }
  }
  const text = output.join("\n"); return text.length > 48_000 ? `${text.slice(0, 47_900)}\n[差异展示已截断；修改内容仍按完整文件校验]` : text;
}
export function applyReplacements(text: string, replacements: { before: string; after: string }[]): string {
  const ranges = replacements.map(item => { const start = text.indexOf(item.before); if (!item.before || start < 0 || text.indexOf(item.before, start + 1) >= 0) throw new Error("project_patch_ambiguous"); return { ...item, start, end: start + item.before.length }; }).sort((a, b) => a.start - b.start);
  if (ranges.some((item, i) => i > 0 && ranges[i - 1]!.end > item.start)) throw new Error("project_patch_overlap");
  for (const item of ranges.reverse()) text = text.slice(0, item.start) + item.after + text.slice(item.end);
  return text;
}
