# 测试与验证

| 命令 | 目的 |
| --- | --- |
| `npm run lint` | ESLint 静态检查 |
| `npm run typecheck` | TypeScript 严格类型检查 |
| `npm run test` | 全部 Vitest 单元与工作流测试 |
| `npm run test:integration` | 资料库和主题隔离集成测试 |
| `npm run eval` | 固定验收评估 |
| `npm run smoke:mock` | 临时根目录中的 CLI 冒烟，禁用真实 Provider，不接触用户数据库 |
| `npm run test:harness` | Agent loop、教学检查点、流式 Provider 适配的定向回归 |
| `npm run verify` | 全部质量门、敏感信息扫描与 diff 检查 |

测试数量随功能演进变化；以 CI 中 `npm run verify` 的实际输出为准。真实 Provider 属于可选环境验收；自动化测试使用 mock/fixture 覆盖协议解析、超时和取消，不会发送真实用户资料。

Agent 故障覆盖：`agent-limits`、`agent-continuation`、`learning-agent`、`learning-agent-cli`、`tool-harness`、`provider-runtime`、`deepseek-client`、`run-manager`、`path-policy`、`teaching-turn` 与 `teaching-session-store`。其中 CLI 工具验收通过 Node preload 注入假 Keychain 和 fetch，使用临时 SQLite 夹具，验证真实入口和适配器而不访问真实凭证或网络。
