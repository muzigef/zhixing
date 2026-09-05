# P3-01：模型无关的个性化学习闭环（历史快照）

> 历史证据：下文的测试数量、命令输出、提交状态、机器配置和“当前”均指本阶段记录时。2026-09-05 文档核对保留这些历史结果；现行功能与配置见 [功能验收](../features-and-acceptance.md)、[配置](../CONFIGURATION.md)，后续阶段见 [证据索引](README.md)。

状态：已实现并完成本地自动化验证。

| 能力 | 实现与边界 | 验证 |
| --- | --- | --- |
| 学习画像 | 每主题本地保存目标、水平、每日分钟和周期；输入受 Zod 范围校验。 | `tests/personal-learning.test.ts` |
| 个性化计划 | 只生成待确认草案；显式启用后才写活动计划。既有 Day 完成规则不变。 | 单元测试、CLI E40 |
| 生成 Skill | 生成可阅读的本地草案；只在显式启用后进入主题 Skill 目录。内容禁止改状态、资料或凭证。 | 单元测试、CLI E40 |
| 资料管理 | `资料概览` 只汇总当前主题资料元数据和画像状态。 | CLI E40 |
| 可选模型建议 | 记录时的建议命令可带 `--允许外发`；当前自然教学与 Provider 策略以 `CLI-REFERENCE.md`、`SECURITY.md` 为准。 | CLI E40（本地路径） |
| Provider 审计 | 运行时审计记录实际执行的 Provider；受控 fallback 时记录 `mock`，而非抽象的 `routed`。 | `tests/model-invocation.test.ts` |

P3 的单独功能已通过；测试基线会随演进变化，以 CI 中 `npm run verify` 的实际输出为准。
