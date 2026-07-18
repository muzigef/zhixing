# 测试与验证

| 命令 | 目的 |
| --- | --- |
| `npm run lint` | ESLint 静态检查 |
| `npm run typecheck` | TypeScript 严格类型检查 |
| `npm run test` | 全部 Vitest 单元与工作流测试 |
| `npm run test:integration` | 资料库和主题隔离集成测试 |
| `npm run eval` | 固定验收评估 |
| `npm run smoke:mock` | 不依赖 Provider 的 CLI 冒烟 |
| `npm run verify` | 全部质量门、敏感信息扫描与 diff 检查 |

最新基线：28 个测试文件、89 个测试通过。真实 Provider 属于可选验收；OS sandbox 文件拒绝与 HTTP/SSE 订阅已纳入自动化覆盖，状态见 `docs/evidence/`。
