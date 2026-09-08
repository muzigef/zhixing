/** Authored concept mapping. IDs are stable; content changes require a new catalog version. */
export const CONCEPT_VERSION = "2026-09-08.1";
export interface LearningConcept { id: string; title: string; topicId: string; dayId: string; questionIndex: number; aliases: string[]; }
const groups: Record<string, [string, string, string[]][][]> = {
  "agent-development": [
    [["execution-evidence", "执行证据", ["执行证据", "模型声明", "测试通过", "execution evidence"]], ["runtime-permissions", "运行时权限", ["运行时权限", "跨主题", "runtime permissions", "权限"]]],
    [["cancellation", "取消传播", ["停止", "取消传播", "cancellation"]], ["tool-errors", "工具错误反馈", ["工具错误", "参数格式", "tool error"]]],
    [["agent-evaluation", "Agent 效果评估", ["评估", "模型质量", "evaluation"]], ["idempotent-recovery", "幂等恢复", ["幂等", "崩溃恢复", "idempotency", "recovery"]]],
  ],
  rag: [
    [["document-extraction", "文档提取", ["扫描", "pdf", "ocr", "文档提取"]], ["citation-location", "引用定位", ["引用", "页码", "citation"]]],
    [["topic-isolation", "主题隔离", ["主题隔离", "跨主题", "topic isolation"]], ["retrieval-trust", "检索信任边界", ["注入", "不可信", "prompt injection"]]],
    [["claim-support", "结论与原文支持", ["依据", "grounding", "原文支持", "claim support"]], ["missing-evidence", "证据不足", ["证据不足", "成本", "missing evidence"]]],
  ],
  "tool-calling": [
    [["input-validation", "输入校验", ["schema", "参数校验", "input validation"]], ["raw-input-boundary", "原始输入越界检查", ["原始参数", "跨主题", "raw input"]]],
    [["path-isolation", "文件路径隔离", ["符号链接", "路径", "symlink"]], ["approval-scope", "授权范围", ["授权", "批准", "approval"]]],
    [["unknown-tool-result", "未知工具结果", ["超时", "未知结果", "timeout"]], ["safe-audit", "脱敏审计", ["审计", "脱敏", "audit"]]],
  ],
  "interview-project": [
    [["measured-claims", "量化结论的测量", ["性能", "测量", "对照", "measurement"]], ["acceptance-goal", "可验收目标", ["验收", "目标", "acceptance"]]],
    [["architecture-boundaries", "架构职责和失败路径", ["架构", "职责", "architecture"]], ["reliable-single-task", "可靠单任务", ["单任务", "多 agent", "multi-agent"]]],
    [["uncertainty", "不确定性表达", ["不确定", "边界", "uncertainty"]], ["failure-analysis", "失败复盘", ["复盘", "失败原因", "failure analysis"]]],
  ],
};
export function topicConcepts(topicId: string): LearningConcept[] {
  return (groups[topicId] ?? []).flatMap((day, dayIndex) => day.map(([id, title, aliases], questionIndex) => ({ id, title, aliases, topicId, dayId: `D${String(dayIndex + 1).padStart(2, "0")}`, questionIndex })));
}
export function reviewRequest(query: string): boolean { return /(?:学习|练习|复习|实验|课程).*(?:情况|进度|下一步|建议)|下一步|复习|my (?:learning|practice|progress)|what.*next|review my/i.test(query); }
export function matchingConcepts(topic: string, query: string): LearningConcept[] {
  const text = query.toLowerCase();
  return topicConcepts(topic).filter(concept => concept.aliases.some(alias => /[a-z]/i.test(alias) ? new RegExp(`\\b${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text) : text.includes(alias)));
}
