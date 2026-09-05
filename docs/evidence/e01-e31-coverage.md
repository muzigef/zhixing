# E01–E31 验收覆盖映射

> 历史证据：下文的测试数量、命令输出、提交状态、机器配置和“当前”均指本阶段记录时。2026-09-05 文档核对保留这些历史结果；现行功能与配置见 [功能验收](../features-and-acceptance.md)、[配置](../CONFIGURATION.md)，后续阶段见 [证据索引](README.md)。

> 状态：历史 P0 验证快照。所有项均有单元、集成、Eval 或隔离 headless CLI 证据；当时未执行真实 Provider smoke。当前策略与基线以 `SECURITY.md`、`TASKS.md` 和 `npm run verify` 为准。

| 验收 | 当前状态 | 自动化证据 |
| --- | --- | --- |
| E01–E06 | 已覆盖 | `tests/cli-workflow.test.ts`、`tests/eval.test.ts`：Day 输出、前置、review、继续和源码 gate |
| E07 | 已覆盖 | `RunManager`、CLI SIGINT、AbortSignal、`run_cancelled` 审计和取消后新 Run 可用性已覆盖 |
| E08 | 已覆盖 | PathPolicy、inbox 越界与受控 Store 符号链接写入拒绝 |
| E09 | 已覆盖 | SkillCatalog 坏 frontmatter fail-closed 与旧 catalog 保留 |
| E10 | 已覆盖 | AuditLogger 脱敏、递增 Run 事件、model metadata 与 headless CLI 工具事件链已覆盖 |
| E11–E12 | 已覆盖 | Provider fallback CLI、重复工具调用与 6 轮最大模型事件 |
| E13–E16 | 已覆盖 | 隔离 CLI 的主题前置、session 恢复、跨主题写拒绝和全部进度 |
| E17–E20 | 已覆盖 | Keychain mock、Codex/DeepSeek mock、模型列表/状态、角色路由与 fallback |
| E21–E24 | 已覆盖 | PDF/扫描、检索、证据不足、资料列表与 citation 定位 |
| E25–E26 | 已覆盖 | 记忆确认写入/删除、主题隔离与显式全局查询 |
| E27–E31 | 已覆盖 | 文件/页数/主题配额、加密/损坏/取消、citation 清理、备份恢复与外发确认 CLI |

真实 Provider smoke 仍为可选项，不影响 P0 mock 发布门。
