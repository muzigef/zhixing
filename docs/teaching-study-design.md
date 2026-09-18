# 冻结教学研究、随机分组与失访统计

2026-09-18。工程支持预先登记的封闭参与者名单、简单 1:1 随机分组与意向性统计。没有真实参与者数据、身份认证或因果结论；原有个人验证仍为自选，不能事后改名随机研究。

## 负责人在收集前固定

只使用 `P001` 一类研究代号；先取得参与同意，身份对应表单独保管。当前采用全名单一次分配，不支持滚动招募或自适应分配。负责人把以下 JSON 保存为 plan.json（示例人数和模型须按实际研究修改）：

```json
{
  "version": 1, "topicId": "rag", "protocol": "full_product",
  "codeHash": "0000000000000000000000000000000000000000000000000000000000000000",
  "provider": "native-codex", "model": "actual-model", "reasoning": "quick", "style": "adaptive",
  "minimumLearningMs": 600000, "primaryMetric": "delayed_correct", "minimumRetentionHours": 72,
  "plannedParticipants": 4,
  "sampleRationale": "可行性试用：核对研究流程负担与失访，不据此声称足够统计效力。",
  "hypothesis": "知行引导组与同模型直接聊天组在延迟答对数上的预先比较。",
  "missingRule": "bounds", "dataOrigin": "real_declared", "allocation": "simple_random_1_to_1"
}
```

`participants.json` 是恰好 plannedParticipants 个不同代号的数组。正式研究的样本量应依据预期效应、变异、失访和目标精度另行论证；工具验证填写与冻结，不自动认证论证合理。当前主要指标固定为实际 72 小时后的三题答对数，范围 0–3；不能看结果后改指标或缺失规则。

```sh
node --import tsx scripts/teaching-study.ts create --plan=plan.json --participants=participants.json --output=coordinator-registry.json
node --import tsx scripts/teaching-study.ts ticket --registry=coordinator-registry.json --participant=P001 --output=P001-ticket.json
```

每个代号由密码学随机源独立等概率分配 zhixing/direct。简单随机不保证组数相等，小样本可能只有一个组，此时不产生组间差。完整清单由负责人私下保管；只发给参与者自己的 ticket，不发其他代号/组别。重复导出票据保持同一 trial ID 和分组。文件禁止覆盖；不要另建清单重抽分组。哈希检测意外变化，不是签名，也不能证明分配隐藏、身份唯一或负责人未重抽。

## 在产品里执行

桌面「学习效果验证 → 参加已分组的教学研究」导入自己的 ticket。主进程和共享 LearningOutcomeStore 校验格式/哈希、主题、分配时间，使用固定方式开始；普通聊天不能修改分组。重复导入幂等，不创建第二份答卷。已有同主题验证的工作区拒绝新研究代号；每位参与者使用自己未参与过该主题的工作区，不能换代号清除既往暴露。入组后仍遵守同一教学、迁移、72 小时保持和复核机制。

模型或构建不会因票据静默切换。负责人按冻结条件配置；运行后的条件偏离如实记入研究报告。学习者可退出，已发生的记录保留。资料分享仍依产品原有授权，不由研究文件授予。

## 按全体分配者核对

```sh
node --import tsx scripts/teaching-study.ts report --registry=coordinator-registry.json --output=study-report.json export1.json export2.json
```

也可不提供导出，生成全体尚未开始的报告。先验证导出答案/评分来源与重复快照，再逐条核对票据、代号、trial ID、组别、主题与时间；拒绝清单外答卷、自选记录改名、票据或分组冲突。

- 分母始终是清单中的全体分配者，包括未开始、中止、借助帮助、改变条件和缺失延迟结果的人。
- `observedMean` 只是已有测量者均分；`perProtocol` 仅为附加合规描述，均不能冒充意向性主结果。
- `bounds`：有缺失时主要点估计为空，按每个缺失结果可能为 0–3 给出最差/最好上下界及组间差上下界；这些不是置信区间。只有事先选择 `zero_imputation` 才另外给出缺失填零估计，仍保留缺失数和上下界。
- 借助帮助和改变条件的有效延迟观察保留在意向性分析中，并列出偏离；未满 72 小时的结果保留原分数但不冒充预设延迟指标。
- 分组失访率及其差值单列，人数不足/单组为空如实报告。

真实身份、独立评阅、同意、实际招募和分配隐藏仍须负责人核实。即使工程核验通过，`realStudyVerified` 与 `causalEffectEstablished` 也不会自动变成 true。结合[材料就绪检查](teaching-readiness.md)与[研究执行说明](teaching-study-protocol.md)使用。

实现：[冻结清单](../src/teaching-study-registry.ts)、[共享入组](../src/learning-outcomes.ts)、[意向性报告](../src/teaching-study.ts)。专项测试含实际 CLI、重复导入、污染工作区、改组、失访和辅助作答保留。
