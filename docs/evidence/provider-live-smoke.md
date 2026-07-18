# 真实 Provider Smoke 状态

状态：跳过（非阻塞）。

知行应用默认纯本地运行；当前未设置 `ZHIXING_ALLOW_LIVE_PROVIDER=1`，因此不会调用外部 Provider。执行真实 smoke 还要求本机官方 CLI 已由用户完成登录。mock Provider、fallback 与脱敏审计已由自动化测试覆盖。
