# 真实 Provider Smoke 状态

> 历史证据：下文的测试数量、命令输出、提交状态、机器配置和“当前”均指本阶段记录时。2026-09-05 文档核对保留这些历史结果；现行功能与配置见 [功能验收](../features-and-acceptance.md)、[配置](../CONFIGURATION.md)，后续阶段见 [证据索引](README.md)。

状态：历史快照，跳过（非阻塞）。

记录时的策略为默认纯本地。当前策略已变更：已配置 Provider 默认可用，设置 `ZHIXING_ALLOW_LIVE_PROVIDER=0` 才会禁止调用。执行真实 smoke 仍要求本机官方 CLI 已由用户完成登录。mock Provider、fallback 与脱敏审计已由自动化测试覆盖。
