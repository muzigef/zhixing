export interface EvidenceInput {
  readonly implementation: boolean;
  readonly testOutput: boolean;
  readonly failureCase: boolean;
  readonly reflection: boolean;
}

export interface ReviewVerdict {
  readonly outcome: "advance" | "reinforce" | "repair";
  readonly score: number;
  readonly missing: readonly string[];
  readonly nextAction: string;
}

/** Deterministic baseline reviewer; model analysis can enrich but never override its evidence gate. */
export function reviewEvidence(evidence: EvidenceInput, required: readonly (keyof EvidenceInput)[] = ["implementation", "testOutput", "failureCase", "reflection"]): ReviewVerdict {
  const labels: Record<keyof EvidenceInput, string> = {
    implementation: "实现产物",
    testOutput: "测试输出",
    failureCase: "失败案例",
    reflection: "复盘",
  };
  const checks: Array<[keyof EvidenceInput, string]> = required.map((key) => [key, labels[key]]);
  const missing = checks.filter(([key]) => !evidence[key]).map(([, label]) => label);
  const score = checks.length === 0 ? 0 : Math.round(((checks.length - missing.length) / checks.length) * 8);
  if (missing.length === 0) return { outcome: "advance", score, missing, nextAction: "可进入下一学习日。" };
  if (required.some((key) => ["implementation", "testOutput", "failureCase"].includes(key) && !evidence[key])) return { outcome: "repair", score, missing, nextAction: `先完成：${missing.join("、")}。` };
  return { outcome: "reinforce", score, missing, nextAction: `补充：${missing.join("、")}。` };
}
