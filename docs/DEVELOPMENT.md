# 开发指南

## 常用命令

```bash
npm ci
npm run lint
npm run typecheck
npm run test
npm run verify
```

新增行为应先补充失败或边界测试，再做最小实现。涉及 CLI、资料库、SQLite、记忆或状态机时，运行 `npm run verify`。

## 工程约束

- TypeScript ESM，严格类型检查。
- 主题由 `topicId` 隔离；所有用户路径经 `PathPolicy`。
- 默认纯本地；不得把资料、记忆、凭证或审计发送至外部 Provider。
- 不使用 focused/skipped 测试；`verify` 会扫描敏感信息和 diff 空白错误。

详细自动化规则见 [AI 执行协议](ai-execution-protocol.md) 与 [项目约束](pi-constraints.md)。
