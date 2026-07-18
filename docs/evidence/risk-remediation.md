# 面试 Demo 风险收口记录

状态：已完成本轮高优先级收口。

| 风险 | 收口措施 | 验证 |
| --- | --- | --- |
| SSE 只有 ready 事件 | `Run` 完成后发布 topic-scoped progress；未知 topic 返回 404；CLI 在单命令服务模式等待 SIGINT 后关闭 listener。 | `tests/p2.test.ts` 的真实 HTTP/SSE 订阅测试。 |
| OS sandbox 读取范围过宽 | 移除全局 `file-read*`/`process*`，仅允许命令、系统运行时和临时目录；清空继承环境。 | `tests/p2.test.ts` 验证 `/etc/hosts` 被拒绝。 |
| SQLite 恢复与 WAL 连接冲突 | CLI 在恢复前关闭连接，清理 WAL/SHM，恢复后重新创建数据库与资料库实例。 | 全量 CLI workflow 与备份测试。 |
| OCR 顺序/挂起 | 使用数字页序并为 `pdftoppm`、Tesseract 设置 30 秒超时。 | P2 测试和 typecheck。 |
| 审计符号链接写入 | 审计目录创建前后执行 `assertNoSymlink`。 | 受现有路径策略与全量测试覆盖。 |
| 交付缺 CI | 增加 GitHub Actions macOS 验证与生产依赖高危审计。 | `.github/workflows/verify.yml`。 |

仍保留的边界：真实 Provider smoke 由用户授权控制；真实 OCR 成功和 sandbox 网络拒绝不是自动化发布门。该项目定位为本地优先、可验证的面试 Demo，不宣称为通用生产平台。
