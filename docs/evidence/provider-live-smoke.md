# 真实 Provider Smoke 状态

状态：历史快照，跳过（非阻塞）。

记录时的策略为默认纯本地。当前策略已变更：已配置 Provider 默认可用，设置 `ZHIXING_ALLOW_LIVE_PROVIDER=0` 才会禁止调用。执行真实 smoke 仍要求本机官方 CLI 已由用户完成登录。mock Provider、fallback 与脱敏审计已由自动化测试覆盖。
