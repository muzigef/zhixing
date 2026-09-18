# 评测设计冻结、曝光与消融

2026-09-18。工程入口为 `src/evaluation-design.ts` 和 `scripts/evaluation-design.ts`。它核对声明、版本和文件一致性，不生成模型质量或学习效果结论。

在运行前准备 spec JSON，字段与 `freezeEvaluationDesign` 的 schema 对应：版本/id/注册时间、数据集哈希与每题曝光状态、评分标准哈希、主要指标、假设、比较类型、2–4 个组的条件。每组明确 code/model/runtime/prompt/context/tools/retrieval/reasoning/budget/orchestration。未知条件不能填 unknown 后当作匹配。

```bash
node --import tsx scripts/evaluation-design.ts freeze --spec=spec.json --output=new-frozen-design.json
node --import tsx scripts/evaluation-design.ts check --design=new-frozen-design.json --runs=run-receipts.json --exposures=exposure-events.json --output=new-design-check.json
```

freeze/check 输出均禁止覆盖。运行回执数组每项含 arm、startedAt、datasetHash、rubricHash、conditions、reportHash；应从原始运行报告提取并核对，保留原报告。检查失败仍写出问题报告并返回非零退出码。不能把手工声明的回执当成供应商签名证明；文件哈希与时间声明也不是第三方时间戳认证。

- `single_factor` 和 `ablation` 要求指定 factor，且相对于基线只改变该项；同时换模型、预算或提示词会拒绝。移除审查等实验应在独立评测入口中执行，不能降低日常产品的权限或未知写入保护。
- `system` 允许多个条件一起变化，结论只能归于整体方案，不能声称某一模块造成改善。同预算上限也不等于实际等算力。
- 运行条件必须与冻结设计逐项匹配；数据集、评分规则、注册先后顺序与缺失组分别报告。不要为了当前答案降低评分规则；改规则就重新版本化和注册，旧结果保留。

数据集分 development、regression、claimed_unseen_holdout；最后一项仍只是未见声明。公开、作者已见或用于调优的题不能注册成未见保留集。曝光事件包含 caseId、at、kind（prompt_viewed/answer_viewed/tuning/public）和说明；未知题号拒绝。两组运行之间发生曝光会使整体比较失去未见资格；运行后曝光也保留，后续使用须检查该历史。项目 D/H/Q/X 和 RAG/摘要公开开发题不因旧文件名含 holdout 而自动变为未见数据。

普通回答评测现在先保存完整题目/评分标准哈希再派发第一条请求；调用方修改题目副本或返回自带 criteria 不会改写冻结标准。RAG 在第一题之前保存全题集评分标准，并把相同运行条件复制到 quality sidecar，防止离开主报告后丢失检索、模型或构建条件。评分标准哈希同时覆盖 explanation-v1 的维度定义与逐题要求。

团队阶段导出的维度评分标准是在 export_time 绑定；原题的字段 oracle 早已包含在原数据集哈希中，但后加的维度评阅不能倒称为运行前注册。旧证据文件和已有评分不改写成新协议。

这套门禁已通过真实 CLI 与篡改/多因素/事后注册/评分变化用例验证。它不替代未参与调优的保留集、实际独立评阅或真实学习者实验；当前三模型扩展质量运行仍受 Kimi 连接条件限制。
