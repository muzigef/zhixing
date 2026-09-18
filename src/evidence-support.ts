import { z } from "zod/v4";
import type { SearchResult } from "./contracts.js";
import { citationMarker } from "./citation-marker.js";
import { citationSchema } from "./learning-contracts.js";
import { sourceHash } from "./source-version.js";

const issueSchema = z.object({ code: z.enum(["unsupported_quantity", "uncited_quantity", "overstated_claim", "unverified_quote", "source_unavailable", "ambiguous_source", "contradicted_measurement", "condition_unverified"]), detail: z.string().max(240), claimIndex: z.number().int().nonnegative() });
export const evidenceSupportSchema = z.object({ method: z.literal("deterministic_checks"), version: z.literal(1), claims: z.array(z.object({ text: z.string().max(300), sources: z.array(z.object({ citation: citationSchema, excerptStart: z.number().int().nonnegative(), excerptEnd: z.number().int().nonnegative(), excerptHash: z.string().regex(/^[a-f0-9]{64}$/) })).max(8) })).max(24), issues: z.array(issueSchema).max(24), notice: z.string().max(240) });
export type EvidenceSupport = z.infer<typeof evidenceSupportSchema>;
const markerPattern = /\[[^\]\n]+#(?:page|anchor)=[^\]\n]+\]/g;
const quantities = (text: string) => [...text.matchAll(/(?:[$¥￥]\s*)?\d+(?:\.\d+)?\s*(?:%|％|倍|万元|万次|亿元|亿次|元|美元|毫秒|秒|ms\b|s\b|次|GB\b|MB\b)/gi)].map(match => match[0].replace(/\s|,/g, "").replace("％", "%").toLowerCase());
const normalize = (text: string) => text.normalize("NFKC").replace(/\s+/g, "");

type MeasurementIssue = "unsupported_quantity" | "contradicted_measurement" | "condition_unverified";
const dimensions = [/成本|费用|cost/i, /延迟|耗时|latency|duration/i, /命中率|hit rate/i, /准确率|accuracy/i, /召回率|recall/i];
const direction = (text: string) => /降低|减少|下降|降至|降到|reduc|decreas|fell|drop/i.test(text) ? -1 : /增加|提高|上升|增至|升至|increas|rose|risen/i.test(text) ? 1 : 0;
const relation = (text: string) => /降至|降到|增至|升至|(?:降低|增加|减少)(?:了)?(?:至|到)|\b(?:to)\s+\d/i.test(text) ? "level" : /降低|减少|增加|提高|下降|上升|\bby\s+\d/i.test(text) ? "delta" : undefined;
const isTransition = (text: string) => /从.+?(?:到|至)|\bfrom\b.+?\bto\b/i.test(text);
const sentences = (text: string) => text.split(/[。；;\n]|\.(?=\s|$)/i);
function measurementClauses(text: string) {
  return sentences(text).flatMap(sentence => {
    let dimension = -1, percentile: string | undefined;
    return sentence.split(/[，,]/).map(clause => {
      const found = dimensions.findIndex(pattern => pattern.test(clause)); if (found >= 0) dimension = found;
      percentile = clause.match(/\bP(?:50|90|95|99)\b/i)?.[0].toLowerCase() ?? percentile;
      return { clause, sentence, dimension, percentile, numbers: quantities(clause) };
    });
  }).filter(clause => clause.numbers.length);
}
function conditionPreserved(source: string, claim: string): boolean {
  const condition = source.match(/(?:仅|只)(?:在|当)([^，,。；;\n]{1,80}?)(?:时|下)(?=[，,\s])/u)?.[1]
    ?? source.match(/\bonly (?:when|if) ([^,.;!?\n]{1,100}),/i)?.[1];
  if (!condition) return true;
  const canonical = (value: string) => normalize(value).toLowerCase().replace(/命中缓存/g, "缓存命中");
  const haystack = canonical(claim), needle = canonical(condition); let offset = -1;
  while ((offset = haystack.indexOf(needle, offset + 1)) >= 0) {
    const prefix = haystack.slice(Math.max(0, offset - 10), offset);
    if (!/(?:未|不|无|没有|not|without|是否|regardless)[^，,。；;]{0,3}$/.test(prefix)) return true;
  }
  return false;
}
function calculatedQuantity(number: string, source: ReturnType<typeof measurementClauses>[number], claim: ReturnType<typeof measurementClauses>[number]): boolean {
  // Only a two-endpoint, same-unit, named-metric transition; no eval or general symbolic algebra.
  if (claim.dimension < 0 || source.percentile !== claim.percentile || !isTransition(source.clause) || source.numbers.length !== 2 || !/(?:即|计算|相当于|由此|therefore|equivalent)/i.test(claim.sentence) || relation(claim.clause) === "level") return false;
  const parse = (value: string) => /^(\d+(?:\.\d+)?)(.+)$/.exec(value);
  const before = parse(source.numbers[0]!), after = parse(source.numbers[1]!), value = parse(number);
  if (!before || !after || !value || before[2] !== after[2]) return false;
  const from = Number(before[1]), to = Number(after[1]);
  const change = Math.sign(to - from); if (!change || direction(claim.clause) !== change) return false;
  const expected = value[2] === before[2] ? Math.abs(to - from) : value[2] === "%" && from > 0 ? Math.abs((to - from) / from * 100) : NaN;
  const actual = Number(value[1]); if (!Number.isFinite(expected) || !Number.isFinite(actual)) return false;
  if (Math.abs(expected - actual) < 1e-9) return true;
  const decimals = value[1]!.split(".")[1]?.length ?? 0;
  return /约|大约|approximately|about/i.test(claim.clause) && decimals <= 6 && Number(expected.toFixed(decimals)) === actual;
}
/** Deliberately narrow relation checks, not a general entailment classifier. */
function inspectMeasurements(asserted: string, sources: readonly SearchResult[], adjacentQualifier = ""): MeasurementIssue[] {
  const issues = new Set<MeasurementIssue>();
  const facts = sources.flatMap(source => measurementClauses(source.text)).filter(fact => !/尚未|未验证|未测量|没有验证|(?:没有|并未|未能)(?:降低|减少|增加|提高)|吗[？?]|\b(?:not measured|not verified|unverified|(?:not|never) (?:reduc|increas|decreas)\w*)\b/i.test(fact.clause) && !/假设|例如|示例|\b(?:hypothetic\w*|suppose|example)\b/i.test(fact.sentence) && !/[?？]/.test(fact.clause));
  for (const claim of measurementClauses(asserted)) for (const number of claim.numbers) {
    const related = facts.filter(fact => (claim.dimension < 0 || claim.dimension === fact.dimension) && (!claim.percentile || claim.percentile === fact.percentile));
    const same = related.filter(fact => fact.numbers.includes(number));
    const calculated = related.filter(fact => calculatedQuantity(number, fact, claim));
    if (!same.length && !calculated.length) { issues.add("unsupported_quantity"); continue; }
    const compatible = [...same.filter(fact => !(direction(claim.clause) && direction(fact.clause) && direction(claim.clause) !== direction(fact.clause)) && !(relation(claim.clause) && relation(fact.clause) && relation(claim.clause) !== relation(fact.clause)) && !(isTransition(claim.clause) && isTransition(fact.clause) && JSON.stringify(claim.numbers.slice(0, 2)) !== JSON.stringify(fact.numbers.slice(0, 2)))), ...calculated];
    if (!compatible.length) issues.add("contradicted_measurement");
    else {
      const attached = asserted.match(/[；;]\s*(?:这一|该|本次)(?:比较|结果|实验)[^。！!?\n]*/)?.[0] ?? "";
      const context = /所有|全部|无论|不论|regardless|all requests/i.test(claim.sentence) ? claim.sentence : claim.sentence + attached + adjacentQualifier;
      if (!compatible.some(fact => conditionPreserved(fact.sentence, context))) issues.add("condition_unverified");
    }
  }
  return [...issues];
}

/** Narrow, explainable checks. Passing these rules never means semantic truth was established. */
export function inspectEvidenceSupport(text: string, evidence: readonly SearchResult[]): EvidenceSupport {
  const report: EvidenceSupport = { method: "deterministic_checks", version: 1, claims: [], issues: [], notice: "仅检查引用定位、部分指标/数值/方向/显式条件、原文引号及过强措辞；通过不代表语义蕴含、数学推导或代码正确，隐含条件和跨句推断仍需复核。" };
  const prose = text.replace(/(^|\n)\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n\s*\2(?=\s|$)|$)/g, "").replace(/`[^`\n]*`/g, "");
  const lines = prose.split(/\n/).filter(line => line.trim());
  for (const [lineIndex, line] of lines.entries()) {
    const markers: string[] = line.match(markerPattern) ?? [];
    const plain = line.replace(markerPattern, "").trim();
    // A rejected proposition is not an asserted measurement or source quotation.
    // Stop at clause boundaries and contrasts so a denial cannot hide a later claim.
    const asserted = plain.replace(/(?:不能|无法|不足以|无从)(?:根据[^，。；;]{0,20})?(?:证明|确认|推断|得出|支持)(?:(?!(?:但是|但|然而|不过|且|实际|同时))[^\n，,。；;！？!?])*/g, "");
    const affirmative = asserted.replace(/\b(?:cannot|can[’']t|does not|do not|doesn[’']t|don[’']t)\s+(?:establish|prove|confirm|support|infer)\b(?:(?!\b(?:but|however|yet)\b|\.(?=\s|$))[^,;!?])*/gi, "");
    const numbers = quantities(affirmative);
    const uncitedMeasurement = !markers.length && numbers.length && /成本|延迟|耗时|降低|提高|提升|减少|增加|measured|cost|latency|reduced|improved/i.test(asserted);
    if (!markers.length && !uncitedMeasurement || report.claims.length >= 24) continue;
    const sources = evidence.filter(item => markers.includes(citationMarker(item.citation))).slice(0, 8);
    const claimIndex = report.claims.length;
    report.claims.push({ text: plain.slice(0, 300), sources: sources.map(item => ({ citation: item.citation, excerptStart: 0, excerptEnd: item.text.length, excerptHash: sourceHash(item.text) })) });
    const issue = (code: EvidenceSupport["issues"][number]["code"], detail: string) => { if (report.issues.length < 24) report.issues.push({ code, detail, claimIndex }); };
    if (uncitedMeasurement) { issue("uncited_quantity", "量化结论没有紧邻的资料引用，不能把其他段落的引用当作它的依据。"); continue; }
    if (markers.some(marker => !sources.some(item => citationMarker(item.citation) === marker))) issue("source_unavailable", "部分引用未对应本轮取得的原文片段。");
    if (markers.some(marker => new Set(sources.filter(item => citationMarker(item.citation) === marker).map(item => item.citation.documentId)).size > 1)) issue("ambiguous_source", "同名来源标记对应多个文档，请使用能区分的来源重新核对。");
    const next = lines[lineIndex + 1] ?? "", nextMarkers: string[] = next.match(markerPattern) ?? [];
    const nextPlain = next.replace(markerPattern, "").replace(/[*_]/g, "").trim();
    const adjacentQualifier = /^(?:这一|该|本次)(?:比较|结果|实验).{0,12}?(?:仅|只)(?:适用|针对|包括)/.test(nextPlain) && !/不仅|不只|不限|并非/.test(nextPlain) && !quantities(nextPlain).length && markers.length > 0 && markers.every(marker => nextMarkers.includes(marker)) && nextMarkers.every(marker => markers.includes(marker)) ? nextPlain : "";
    const measurements = inspectMeasurements(affirmative, sources, adjacentQualifier);
    for (const code of measurements) issue(code, code === "unsupported_quantity" ? "引用片段没有支持该指标/分位数的精确数值，示例或尚未验证的数字不能当作实测。请补充来源或可核查的推导。" : code === "contradicted_measurement" ? "回答与来源的变化方向或数值关系不同，例如把增加改为降低、把降至改为降幅。" : "量化结论没有保留来源的显式适用条件，或条件相反。请写出该条件；规则不能自行确认任意同义改写。");
    const absolute = affirmative.replace(/(?:不能|无法|不|未必)(?:保证|确保|一定|必然)|(?:not|never)\s+(?:guarantee\w*|always|necessarily)/gi, "");
    if (/保证|确保|一定|必然|guarantee\w*|always|never/i.test(absolute) && !sources.some(item => /保证|确保|一定|必然|guarantee\w*|always|never/i.test(item.text) && !/可能|未必|不保证|不能保证|may|might|unless/i.test(item.text))) issue("overstated_claim", "来源没有支持这种必然性表述。请保留适用条件，区分推断和已验证结论。");
    for (const quoted of affirmative.matchAll(/[“"]([^”"\n]{8,240})[”"]/g)) {
      if (!sources.some(item => normalize(item.text).includes(normalize(quoted[1]!)))) { issue("unverified_quote", "引号中的长句未在引用片段中找到，不能作为原文直接引语。"); break; }
    }
  }
  return report;
}
export function evidenceRepairReason(report: EvidenceSupport): string | undefined {
  return report.issues.length ? `证据支持检查：${[...new Set(report.issues.map(issue => issue.detail))].join(" ")} 不得仅补一个位置正确的引用来保留不受支持的结论。` : undefined;
}
