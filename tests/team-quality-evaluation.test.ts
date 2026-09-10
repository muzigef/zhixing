import { expect, it } from "vitest";
import { teamQualityCases } from "../src/team-quality-cases.js";
import { scoreTeamAnswer } from "../src/team-evaluation-cases.js";

it("freezes eight distinct quality cases with independently checked deterministic fields and explanation criteria", () => {
  expect(teamQualityCases).toHaveLength(8); expect(new Set(teamQualityCases.map(item => item.id)).size).toBe(8);
  for (const item of teamQualityCases) {
    expect(item.explanationCriteria.length).toBeGreaterThanOrEqual(3);
    expect(scoreTeamAnswer(item, JSON.stringify({ ...item.expected, explanation: "这是评分器的合成测试答案；解释语义必须另行逐条复核。" })).correct).toBe(true);
  }
  const items = [[3, 4], [2, 6], [4, 7], [2, 5], [3, 6], [2, 3], [2, 5]];
  const valid: { selected: string[]; cost: number; value: number }[] = [];
  for (let mask = 0; mask < 128; mask++) {
    const has = (index: number) => Boolean(mask & (1 << index));
    if (has(1) && !has(0) || has(3) && !has(2) || has(5) && !has(0) || has(6) && !has(4) || has(4) && has(2)) continue;
    const selected = items.filter((_, index) => has(index)); const cost = selected.reduce((n, item) => n + item[0]!, 0);
    if (cost <= 10) valid.push({ selected: items.flatMap((_, index) => has(index) ? [String.fromCharCode(65 + index)] : []), cost, value: selected.reduce((n, item) => n + item[1]!, 0) });
  }
  const best = valid.filter(item => item.value === Math.max(...valid.map(item => item.value)));
  expect(best).toEqual([teamQualityCases.find(item => item.id === "Q04")!.expected]);
  const posterior = 0.01 * 0.9 ** 2 / (0.01 * 0.9 ** 2 + 0.99 * 0.05 ** 2);
  expect(posterior).toBeCloseTo(teamQualityCases.find(item => item.id === "Q07")!.expected.posterior as number, 12);
});
