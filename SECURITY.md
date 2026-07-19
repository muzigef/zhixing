# 安全说明

## 安全边界

- 未配置 Provider 时仅使用本地 mock；配置真实 Provider 后默认允许调用。设置 `ZHIXING_ALLOW_LIVE_PROVIDER=0` 可立即禁止真实 Provider。向真实 Provider 发送的教学/答疑内容明确标记为用户材料，并限制为当前主题的受限上下文。
- `topicId`、导入目录与受控写入路径隔离；资料内容不作为指令执行。
- 删除资料、恢复数据库、写入长期记忆均要求确认。
- 审计脱敏，禁止将 API Key、token、Cookie、用户资料提交到仓库。

## 报告问题

这是私有面试 Demo。请直接联系仓库维护者，并提供最小复现、影响和脱敏日志；不要提交真实资料、凭证或可访问链接。

实现边界与限制见 [安全约束](docs/pi-constraints.md) 和 [架构](docs/architecture.md)。
