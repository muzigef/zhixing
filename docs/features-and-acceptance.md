# 功能与验收（当前实现）

> 本文只描述当前可执行行为。历史阶段设计与旧验收快照见 `docs/evidence/`；它们不覆盖本文件、[CLI 参考](CLI-REFERENCE.md) 或代码。

## 当前功能

| 范围 | 当前行为 | 验证入口 |
| --- | --- | --- |
| 主题与计划 | 内置主题可选择；`创建主题 <topicId> <标题>` 创建受控本地主题。学习画像可生成个性化计划或定制课程；定制课程可经确认启用。 | `tests/cli-workflow.test.ts`、`tests/custom-course-store.test.ts` |
| 学习闭环 | `开始第 N 天` 受前置 Day gate 约束。真实 tutor 下依次进行讲解、答疑、练习，再由实验证据 Review 决定 Day 是否推进。mock 保持确定性学习卡。 | `tests/workflow.test.ts`、`tests/cli-workflow.test.ts` |
| 教学恢复 | 当前主题与受限教学检查点会持久化；重启后恢复 Day、阶段、受限转录与当前练习。 | `tests/current-topic-store.test.ts`、`tests/teaching-session-store.test.ts` |
| 教学动作 | 练习阶段先将自然语言约束为开始练习、作答、索要答案、提问、跳题或改计划；模型分类只是建议。索要答案有确定性优先级，只有可验证来自用户原文的作答才能触发批改和持久化。 | `tests/teaching-dialogue.test.ts` |
| 资料与 RAG | 仅导入 PDF/Markdown；本地 FTS5 与 HashEmbedding 混合检索。回答必须含可定位引用，否则返回 `insufficient_evidence`。 | `tests/integration.test.ts`、`tests/p2.test.ts` |
| Provider | `mock`、`deepseek-api`、`codex-cli` 可按角色路由。已配置真实 Provider 默认可用；`ZHIXING_ALLOW_LIVE_PROVIDER=0` 禁止真实调用。Codex 与 DeepSeek 均支持文本流。 | `tests/provider-*.test.ts`、`tests/codex-client.test.ts`、`tests/deepseek-client.test.ts` |
| Provider trace | 同一 Run 审计链记录 Provider、角色、耗时、状态、事件数、模型回合数与工具调用数；不记录 prompt、回答或工具参数。 | `tests/model-audit.test.ts`、`tests/model-invocation.test.ts`、`tests/run-context.test.ts` |
| 自然交互 | 模型只生成经 Zod 校验的草案；CLI 仅在“直接运行”后执行白名单动作。模型不能运行 Shell 或任意文件写入。 | `tests/intent-parser.test.ts`、`tests/cli-workflow.test.ts` |
| 全局控制层 | 每轮输入先归为确定性命令、计划确认、教学输入或自然输入；随后才进入对应状态机和内容生成。 | `tests/interaction-protocol.test.ts` |
| 全局对话策略 | 命令、模型计划和教学分类共用授权/确认/用户原文证据策略；模型输出只能作为提议，不能单独触发状态写入或批改。 | `tests/interaction-protocol.test.ts`、`tests/teaching-dialogue.test.ts` |
| 运行账本 | 每个前台命令有脱敏审计轨迹和 SQLite 运行/步骤账本；进程遗留的运行启动时标记为中断，不自动重放写操作。 | `tests/run-manager.test.ts`、`tests/workflow-ledger.test.ts` |
| 工具执行契约 | 模型工具调用必须经受控回调；ToolHarness 校验输入、主题上下文、最大风险、截止时间和结果上限。当前 CLI 未给教学模型开放实际工具。 | `tests/model-invocation.test.ts`、`tests/tool-harness.test.ts` |
| 数据生命周期 | 可确认写入/忘记记忆、预览/删除资料、手动备份与确认恢复数据库。当前没有主题删除、自动每日备份、导出或迁移前自动备份。 | `tests/backup-service.test.ts`、`tests/cli-workflow.test.ts` |

## Provider 数据边界

真实 Provider 调用只使用当前主题的最小必要信息：资料问答发送检索证据；学习建议发送画像与资料名称；教学发送当天学习卡及受限主题上下文；自然交互发送当前会话文本。凭证、审计原文、其他主题资料不会发送。详见 [配置](CONFIGURATION.md)。

## 验收规则

- Day 只有在 `检查 DNN --实现 --测试 --失败 --复盘` 通过后才能推进。
- 自然交互的创建计划可在一次“直接运行”中保存画像、生成并启用定制课程；导入、删除、恢复和模型切换仍需明确确认。
- Provider 失败时，允许 fallback 的调用可使用 mock；教学和自然交互不会静默替换成 mock，直接显示错误。
- 本地发布门为 `npm run verify`；真实 Provider smoke 是可选环境验收。

## 非当前实现

当前真实 Provider 尚未实现跨 Provider 的结构化工具续写适配；框架已经提供受限的可续写协议与测试 Provider。完整的注册表分派控制面、token/费用预算、Claude 或本地 HTTP Provider、DOCX 导入、主题删除、云同步和 Web UI 仍属于后续设计，不能作为已交付能力。
