# 0.9 回答质量复核

> 历史验收快照：下文的测试数量、失败、安装及“待验”状态仅适用于记录当次执行；未重新运行或改写历史结果。当前实现与后续进展见 [当前状态](../current-status.md) 和 [证据索引](README.md)。

2026-09-09。开发助手 Codex 按逐条原回答复核，身份为 `development_assistant`、`independent: false`；不是独立人类评价。评分文件绑定完整报告哈希，失败原文未覆盖。任务完成率不能代替内容正确率。

| 报告 | 实际运行 | 严格逐项全通过 | 结论 |
| --- | --- | --- | --- |
| completion-quality-final | Flash / balanced，12 题各两次；22 completed、2 waiting | 9 / 24 | 不能宣称回答质量全部通过；还有简化过度、无依据比较、数值解释和重复收尾 |
| completion-pro-comparison | Pro / balanced，4 题各两次 | 4 / 8 | 两条推导与两条纠错通过；比较题仍有过强结论，不能宣称更贵就全面正确 |
| completion-math-deep-final | Flash / deep，同一推导两次 | 0 / 2 | 一次数值方向解释错误，一次一般方向解释遗漏特征符号条件；深入思考不是正确性保证 |
| completion-prerequisites-final | 修复后 Flash / balanced，进度题两次 | 2 / 2 | 前置课程名称、时长与顺序准确，原错误记录保留 |

上述报告对应不同源码快照/任务子集；Pro 和 Flash 深思考检查有并行运行，不用它们比较延迟。主集与旧留出集均已用于修复，是回归题，不再是独立未见题。评分仅针对合成案例，没有商业 Agent 同条件对照，也没有学习者效果因果结论。

## 已落实的修复

- 共享回答规则明确矩阵维度、误差符号、必要/充分条件和选型适用边界，不用无关进度信息打断普通问答。
- 引用修复要求重写原问题的答案；显式否认某个费用数字不再误判为肯定数值断言，邻近伪造断言仍拒绝。
- 当前课程与前置课程均绑定自己的主题/学习日与实际标题、时长；仅加入引用课程的定义，不泄漏前置主题的私有记忆或资料。确定性回归和真实进度问答复跑均通过。

## 验收判断

本轮已执行真实模型质量评测，并修复可确认的上下文、协议和检查逻辑问题。**开放回答内容尚未达到“全通过”的质量门槛**。例如 Flash 的推导公式可以正确，但数值解释依然可能把方向写反；已有确定性检查也明确不认证数学/语义正确性。

保留模型和思考档位的显式选择，不凭这组小样本自动换模型、默认增加一次模型审校或宣称可靠性保证。独立人类复核、扩大未见题及真实学习效果研究仍需要实际人员与数据；这些条件不能由本文件或自动测试代替。

复核数据：同目录 `completion-quality-final-review.json` / `-summary.json`、`completion-pro-comparison-review.json` / `-summary.json`、`completion-math-deep-final-review.json` / `-summary.json`、`completion-prerequisites-final-review.json` / `-summary.json`。原回答分别位于同名不含后缀的 JSON。
