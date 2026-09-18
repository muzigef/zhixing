# 盲评、校准与一致性

2026-09-18。此流程处理显式导出的合成回答或学习者答卷，不主动读取会话库、联系评阅者或调用模型。包准备、评分导入和真实人评完成分别计数。

## Agent 回答

```bash
node --import tsx scripts/review-quality-blind.ts create --report=quality.json --output=new-pack
node --import tsx scripts/review-quality-blind.ts import --report=quality.json --packet=new-pack/reviewer.json --coordinator=new-pack/coordinator-private.json --response=reviewer-a.json --output=new-review-a.json
node --import tsx scripts/review-quality-blind.ts compare --report=quality.json --a=new-review-a.json --b=new-review-b.json --output=new-agreement.json
```

负责人只向评阅者提供 reviewer.json；coordinator-private.json 保存匿名 ID 到实验组的映射，必须分开。题目/回答/逐项标准/必要历史或 RAG 证据保留，模型、组别、题号、时间和原评分元数据隐藏；原文自行透露身份无法自动消除，分享前仍需检查。

评阅响应包含 `version: 1`、`packetHash`、`reviewer: {name, kind, independent}` 与 `ratings`。每项用 `itemId`，并填写 `criteria`、三项 `dimensions`、`rationale`、`failures`；维度字段见 [解释评分](explanation-quality-review.md)。可填 `guessedProvider`，仅用于检查评阅者是否可能识别组别。不会把“未猜中”当作独立性证明。

导入逐项验证报告、包、标准、原文、映射与摘录；重复 ID、错包、陈旧原文和未知项均拒绝。匿名包不允许导入者通过替换题目或标准来改变评价对象。输出为可供 review-agent-quality.ts 使用的 v2 review，原响应应保留。身份和独立性仍由负责人核对，开发助手不可声明独立人评。

## 评阅校准

先使用单独的校准题报告，请领域专家冻结参考评分，再让评阅者独立评分。与正式测试题隔离，不因看过正式结果而修改标准。

```bash
node --import tsx scripts/review-quality-blind.ts calibrate --report=calibration-quality.json --reference=expert-reference.json --reviews=trainee-review.json --output=new-calibration.json
```

比较只记录与指定参考的差异，不自动授予合格认证，也不证明参考是真值。若参考由开发者提出，必须这样标注，不能称为专家共识。没有真实评阅者时状态仍为待校准。

同一回答双方都完成三维评分后才配对。分别报告精确一致率、差 1 分以内比例、平均绝对差、B 减 A 的方向差及二次加权 Cohen kappa；按实验组重复这些统计，检查系统性偏好。常数分布使机会校正分母为零时 kappa 为空；缺失评分单列。较高一致性不代表准确性，小样本/同题重复不能当成独立人群证据。

## 学习者解释

沿用 `create-outcome-review-pack.ts` 创建匿名包；响应数组每个元素含 version、packetHash、reviewer 和 ratings，rating 含 itemId、verdict（supported/partial/unsupported）、feedback。

```bash
node --import tsx scripts/create-outcome-review-pack.ts outcome-export.json --output=new-outcome-pack
node --import tsx scripts/import-outcome-reviews.ts --export=outcome-export.json --packet=new-outcome-pack/reviewer.json --coordinator=new-outcome-pack/coordinator-private.json --responses=two-reviewers.json --output=new-reviewed-export.json
node --import tsx scripts/summarize-learning-outcomes.ts new-reviewed-export.json
```

同一冻结修订上的两位评阅者可一次批量导入，原有历史保留并递增 revision。先全部校验后产生新导出文件；不覆盖原文件，也不修改产品中的实时学习数据库。原文/答卷/修订已变化则拒绝旧包。统计采用每位评阅者最新未撤回评分；三档对应 0/2/4，报告配对一致性与方向差。历史 `human_reviewed` 是人工录入状态，不构成身份或独立性验证。

当前已用合成答卷、实际 CLI 子进程和篡改/冲突用例验证工程流程；没有招募新的真实评阅者，也未形成真实评阅一致性结论。
