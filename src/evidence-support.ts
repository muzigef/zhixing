import { z } from "zod/v4";
import type { SearchResult } from "./contracts.js";
import { citationMarker } from "./citation-marker.js";
import { citationSchema } from "./learning-contracts.js";
import { sourceHash } from "./source-version.js";

const issueSchema = z.object({ code: z.enum(["unsupported_quantity", "uncited_quantity", "overstated_claim", "unverified_quote", "source_unavailable", "ambiguous_source"]), detail: z.string().max(240), claimIndex: z.number().int().nonnegative() });
export const evidenceSupportSchema = z.object({ method: z.literal("deterministic_checks"), version: z.literal(1), claims: z.array(z.object({ text: z.string().max(300), sources: z.array(z.object({ citation: citationSchema, excerptStart: z.number().int().nonnegative(), excerptEnd: z.number().int().nonnegative(), excerptHash: z.string().regex(/^[a-f0-9]{64}$/) })).max(8) })).max(24), issues: z.array(issueSchema).max(24), notice: z.string().max(240) });
export type EvidenceSupport = z.infer<typeof evidenceSupportSchema>;
const markerPattern = /\[[^\]\n]+#(?:page|anchor)=[^\]\n]+\]/g;
const quantities = (text: string) => [...text.matchAll(/(?:[$¥￥]\s*)?\d+(?:\.\d+)?\s*(?:%|％|倍|万元|万次|亿元|亿次|元|美元|毫秒|秒|ms\b|s\b|次|GB\b|MB\b)/gi)].map(match => match[0].replace(/\s|,/g, "").replace("％", "%").toLowerCase());
const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/g, "");

/** Narrow, explainable checks. Passing these rules never means semantic truth was established. */
export function inspectEvidenceSupport(text: string, evidence: readonly SearchResult[]): EvidenceSupport {
  const report: EvidenceSupport = { method: "deterministic_checks", version: 1, claims: [], issues: [], notice: "仅检查引用定位、数值、原文引号及过强措辞；通过不代表语义蕴含、数学推导或代码正确，推断仍需复核。" };
  const prose = text.replace(/(^|\n)\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\s*\2(?=\s|$)|$)/g, "").replace(/`[^`\n]*`/g, "");
  for (const line of prose.split(/\n/).filter(line => line.trim())) {
    const markers: string[] = line.match(markerPattern) ?? [];
    const plain = line.replace(markerPattern, "").trim();
    // A rejected proposition is not an asserted measurement or source quotation.
    // Stop at clause boundaries and contrasts so a denial cannot hide a later claim.
    const asserted = plain.replace(/(?:不能|无法|不足以|无从)(?:根据[^，。；;]{0,20})?(?:证明|确认|推断|得出|支持)(?:(?!(?:但是|但|然而|不过|且|实际|同时))[^\n，,。；;！？!?])*/g, "");
    const numbers = quantities(asserted);
    const uncitedMeasurement = !markers.length && numbers.length && /成本|延迟|耗时|降低|提高|提升|减少|增加|measured|cost|latency|reduced|improved/i.test(asserted);
    if (!markers.length && !uncitedMeasurement || report.claims.length >= 24) continue;
    const sources = evidence.filter(item => markers.includes(citationMarker(item.citation))).slice(0, 8);
    const claimIndex = report.claims.length;
    report.claims.push({ text: plain.slice(0, 300), sources: sources.map(item => ({ citation: item.citation, excerptStart: 0, excerptEnd: item.text.length, excerptHash: sourceHash(item.text) })) });
    const issue = (code: EvidenceSupport["issues"][number]["code"], detail: string) => { if (report.issues.length < 24) report.issues.push({ code, detail, claimIndex }); };
    if (uncitedMeasurement) { issue("uncited_quantity", "量化结论没有紧邻的资料引用，不能把其他段落的引用当作它的依据。"); continue; }
    if (markers.some(marker => !sources.some(item => citationMarker(item.citation) === marker))) issue("source_unavailable", "部分引用未对应本轮取得的原文片段。");
    if (markers.some(marker => new Set(sources.filter(item => citationMarker(item.citation) === marker).map(item => item.citation.documentId)).size > 1)) issue("ambiguous_source", "同名来源标记对应多个文档，请使用能区分的来源重新核对。");
    const dimension = [/成本|cost/i, /延迟|耗时|latency/i, /命中率|hit rate/i].find(pattern => pattern.test(plain));
    const supportedNumbers = new Set(sources.flatMap(item => {
      const statements = item.text.split(/[。；;，,\n]/);
      const related = dimension ? statements.filter(statement => dimension.test(statement)) : statements;
      return quantities(related.join("\n"));
    }));
    if (numbers.some(number => !supportedNumbers.has(number))) issue("unsupported_quantity", "引用片段没有对应的精确数值。请移除量化结论、补充实测来源，或明确给出可验证的计算过程。");
    const absolute = asserted.replace(/(?:不能|无法|不|未必)(?:保证|确保|一定|必然)|(?:not|never)\s+guarantee\w*/gi, "");
    if (/保证|确保|一定|必然|guarantee\w*|always|never/i.test(absolute) && !sources.some(item => /保证|确保|一定|必然|guarantee\w*|always|never/i.test(item.text) && !/可能|未必|不保证|不能保证|may|might|unless/i.test(item.text))) issue("overstated_claim", "来源没有支持这种必然性表述。请保留适用条件，区分推断和已验证结论。");
    for (const quoted of asserted.matchAll(/[“"]([^”"\n]{8,240})[”"]/g)) {
      if (!sources.some(item => normalize(item.text).includes(normalize(quoted[1]!)))) { issue("unverified_quote", "引号中的长句未在引用片段中找到，不能作为原文直接引语。"); break; }
    }
  }
  return report;
}
export function evidenceRepairReason(report: EvidenceSupport): string | undefined {
  return report.issues.length ? `证据支持检查：${[...new Set(report.issues.map(issue => issue.detail))].join(" ")} 不得仅补一个位置正确的引用来保留不受支持的结论。` : undefined;
}
