import { z } from "zod/v4";

export const teamReportSchema = z.object({
  summary: z.string().trim().min(1).max(1800),
  claims: z.array(z.object({ key: z.string().trim().min(1).max(120), value: z.string().trim().min(1).max(600), basis: z.string().trim().min(1).max(1000), evidenceIds: z.array(z.string().length(64)).max(8).optional() }).strict()).max(12),
  uncertainties: z.array(z.string().trim().min(1).max(500)).max(6),
}).strict().refine(value => new Set(value.claims.map(claim => claim.key.toLowerCase())).size === value.claims.length)
  .refine(value => JSON.stringify(value).length <= 8000);
export type TeamReport = z.infer<typeof teamReportSchema>;
export function formatTeamReport(report: TeamReport): string {
  return [report.summary, ...report.claims.map(claim => `${claim.key}：${claim.value}\n依据：${claim.basis}`), ...(report.uncertainties.length ? [`仍有不确定性：${report.uncertainties.join("；")}`] : [])].join("\n");
}
export const teamCheckSchema = z.object({ task: z.string().max(40), sourceTask: z.string().max(40).optional(), criterion: z.number().int().min(0).max(5), status: z.enum(["supported", "unresolved"]), claimKeys: z.array(z.string().max(120)).max(12), evidenceIds: z.array(z.string().length(64)).max(8), reason: z.string().min(1).max(500) }).strict();
export const teamReviewDecisionSchema = z.object({
  verdict: z.enum(["ready", "needs-check", "uncertain"]),
  issues: z.array(z.string().trim().min(1).max(600)).max(6),
  guidance: z.string().trim().min(1).max(1800),
  followUp: z.object({ member: z.number().int().min(1).max(2), question: z.string().trim().min(1).max(1200) }).strict().nullable(),
  checks: z.array(teamCheckSchema).max(48).optional(),
}).strict().refine(value => value.verdict === "needs-check" ? Boolean(value.followUp && value.issues.length) : value.followUp === null)
  .refine(value => value.verdict !== "ready" || value.issues.length === 0);
export function parseTeamJson<T>(schema: z.ZodType<T>, text: string): T {
  if (text.length > 8000) throw new Error("team_report_invalid");
  try { return schema.parse(JSON.parse(text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/, "$1"))); }
  catch { throw new Error("team_report_invalid"); }
}
/** Return schema metadata only: never reflect arbitrary model values or unknown property names. */
export function teamJsonRepairReason(schema: z.ZodType, text: string): string | undefined {
  if (text.length > 8000) return "内部 JSON 超过 8000 字符，需压缩报告，保留关键结论与依据。";
  let value: unknown;
  try { value = JSON.parse(text.trim().replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/, "$1")); }
  catch { return "内部 JSON 语法无效：只输出一个完整对象，使用合法转义，不附加 Markdown 或其他文字。"; }
  const result = schema.safeParse(value); if (result.success) return undefined;
  const fields = new Set(["summary", "claims", "key", "value", "basis", "uncertainties", "verdict", "issues", "guidance", "followUp", "member", "question", "checks", "task", "sourceTask", "criterion", "status", "claimKeys", "evidenceIds", "reason"]);
  const issues = result.error.issues.slice(0, 4).map(issue => {
    const path = issue.path.map(part => typeof part === "number" ? part : fields.has(String(part)) ? String(part) : "field").join(".") || "report";
    const detail = issue.code === "invalid_type" ? `必须为 ${issue.expected}` : issue.code === "unrecognized_keys" ? "不得添加协议外字段" : issue.code === "too_big" ? "超过长度或数量上限" : issue.code === "too_small" ? "缺少必需内容或未达到最小长度" : issue.code === "invalid_value" ? "必须使用协议规定的枚举值" : "跨字段约束不满足：检查 key 唯一性、总长度与审查状态关联";
    return `${path}：${detail}`;
  });
  return `内部 JSON 校验失败：${issues.join("；")}。`.slice(0, 500);
}
export const teamFailureSchema = z.enum(["timeout", "cancelled", "output_limit", "content_filter", "incomplete", "invalid_report", "budget", "authentication", "rate_limit", "unavailable", "unknown"]);
export type TeamFailure = z.infer<typeof teamFailureSchema>;
export function teamFailure(error: unknown, signal?: AbortSignal): TeamFailure {
  if (signal?.aborted) return signal.reason?.name === "TimeoutError" ? "timeout" : "cancelled";
  const message = error instanceof Error ? error.message : "";
  if (/^provider_incomplete: length$|^provider_output_limit$/.test(message)) return "output_limit";
  if (message === "provider_incomplete: content_filter") return "content_filter";
  if (/^(?:provider_timeout|invocation_timeout)(?::|$)/.test(message)) return "timeout";
  if (message === "team_report_invalid" || message === "response_contract_failed") return "invalid_report";
  if (/^team_(?:tool_)?budget_exhausted$/.test(message)) return "budget";
  if (/^provider_unavailable: (?:deepseek|kimi|compatible) HTTP 429$/.test(message)) return "rate_limit";
  if (/^provider_unavailable: (?:deepseek|kimi|compatible) HTTP (?:401|403)$|^pi_login_required$|^secret_store_unavailable$/.test(message)) return "authentication";
  if (/^provider_unavailable(?::|$)/.test(message)) return "unavailable";
  if (/^provider_incomplete$|^member_incomplete$|^provider_protocol_error(?::|$)/.test(message)) return "incomplete";
  return "unknown";
}
export const teamFailureLabels: Record<TeamFailure, string> = { timeout: "核查超时，未获得完整结果。", cancelled: "核查已停止。", output_limit: "输出达到上限，未获得完整核查结果。", content_filter: "模型服务未提供完整内容。", incomplete: "模型响应未完整返回。", invalid_report: "核查结果未符合约定格式。", budget: "已达到共享预算，保留容量供主 Agent 回答。", authentication: "模型认证或系统安全存储不可用。", rate_limit: "模型服务限流或配额不足。", unavailable: "模型服务请求失败。", unknown: "核查未完成，原因尚未确定。" };
export const teamReportInstruction = '只输出核查报告 JSON：{"summary":"简短结论","claims":[{"key":"题目中的字段名或明确命题","value":"值或结论，使用字符串","basis":"可核对的计算、原文依据或反例"}],"uncertainties":[]}。总长控制在 4000 字符内；不确定事项放入 uncertainties。最终用户格式只约束主 Agent 的交付；你的报告须使用此内部协议。结论字段必须与依据一致，逐项核对遗漏、符号、单位和边界。没有运行工具就不得声称测试通过。使用实际工具依据的命题可附 evidenceIds 数组，值只能来自工具返回的 receipt.id；纯推理留空或省略，不得编造回执。';

/** Diagnostic disagreement only: differing string representations are not proof of an error. */
export function reportDisagreements(reports: { member: number; report?: TeamReport }[]) {
  const claims = new Map<string, { member: number; value: string; basis: string }[]>();
  for (const item of reports) for (const claim of item.report?.claims ?? []) {
    const key = claim.key.toLowerCase(); const values = claims.get(key) ?? [];
    values.push({ member: item.member, value: claim.value, basis: claim.basis }); claims.set(key, values);
  }
  return [...claims].filter(([, values]) => new Set(values.map(item => item.value.trim())).size > 1).map(([key, candidates]) => ({ key, candidates }));
}
