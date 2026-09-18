# 教学验收材料就绪检查

2026-09-18。此工具核对材料是否完整，不判定知行教学有效，也不以高分筛选记录。差的迁移答案、复核不一致和零分仍是有效观察。

桌面学前、学后与延迟检查分别采集原解释和新情景迁移作答；不会可如实填写“暂时不会”。迁移题与原文一并保存、绑定评分哈希，不进入教学模型上下文。旧记录保留迁移未采集，不能补写成已测量。延迟门槛仍为实际 72 小时。

解释和迁移分别复核。评阅者声明是否真人、是否独立；桌面独立性默认不勾选。声明不验证身份。盲评包保留迁移问题/原文，导入追加历史，不覆盖原答卷；开发助手不能声明独立人评。

负责人先保存 criteria.json（实际 codeHash 和模型替换示例）：

```json
{
  "version": 1, "topicId": "rag", "protocol": "full_product",
  "codeHash": "0000000000000000000000000000000000000000000000000000000000000000",
  "provider": "native-codex", "model": "actual-model",
  "reasoning": "balanced", "style": "adaptive", "minimumRecords": 10,
  "minimumIndependentReviewers": 2, "minimumRetentionHours": 72,
  "minimumLearningMs": 600000, "dataOrigin": "real_declared"
}
```

人数和时长是负责人预设要求，示例不构成样本量建议。

```sh
node --import tsx scripts/check-teaching-readiness.ts --criteria=criteria.json --output=new-readiness.json export1.json export2.json
```

工具校验导出/评分来源、去重、三阶段作答、迁移采集、双人评分声明、完整学习、构建/模型条件及延迟。材料不足也写出报告并返回非零；拒绝覆盖旧回执。借助帮助、改变条件和重复练习分别报告，不代表这些参与者可以从研究的意向性分析中删除。

`dataCompletenessReady` 仅表示满足声明材料门槛。`participantIdentitiesVerified`、`realStudyVerified`、`causalEffectEstablished` 始终为 false；真实参与身份、独立性、伦理/同意与研究效力须由负责人核实。随机分配、指标冻结、样本依据及失访分析是另外的研究设计环节。

实现：[就绪检查](../src/teaching-readiness.ts)、[契约](../src/outcome-contracts.ts)、[流程测试](../tests/teaching-readiness.test.ts)。自动化采用隔离合成答卷与注入时钟，不改变系统时间，不产生真实学习者效果证据。
