# P1 自动执行 Tasklist

> 历史阶段清单，保留完成标记。当前进展已包含 P6–P10，见 [任务台账](../TASKS.md)；实际功能边界见 [功能与验收](features-and-acceptance.md)。

> P1 聚焦学习产品体验。每项先新增失败/边界测试，再实现最小闭环，最后运行 `npm run verify` 并更新 Evidence。

- [x] P1-01：完整 Topic Plan 解析与按 Day 输出（`requiredEvidence`、时长、可选项）。
- [x] P1-02：完善四个主题的课程内容、实验卡、失败案例与证据模板。
- [x] P1-03：让 tutor、lab、notebook、reviewer 工作流按需加载当前主题 Skill。
- [x] P1-04：完成 grounded natural-language answer 的 CLI 端到端流程，强制 citations 与拒答。
- [x] P1-05：实现评分/错题驱动的复习队列和间隔重复；计划调整不覆盖旧版本。
- [x] P1-06：实现 session snapshot、恢复与历史裁剪，并保持主题隔离。
- [x] P1-07：P1 端到端 Eval、Evidence、README 与任务台账同步。
