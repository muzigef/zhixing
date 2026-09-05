# P2 验收记录

> 历史证据：下文的测试数量、命令输出、提交状态、机器配置和“当前”均指本阶段记录时。2026-09-05 文档核对保留这些历史结果；现行功能与配置见 [功能验收](../features-and-acceptance.md)、[配置](../CONFIGURATION.md)，后续阶段见 [证据索引](README.md)。

状态：实现、边界测试与 loopback HTTP/SSE、OS sandbox 文件拒绝探针已验证；真实 OCR 成功仍不是自动化测试门。

| 项目 | 实现 | 自动化证据 |
| --- | --- | --- |
| P2-01 | `TesseractOcrEngine` 将 PDF 页渲染后在本机识别；均值置信度低于 70 的资料写为 `ocr_low_confidence`，不可用时安全降级为 `ocr_required`。 | `tests/p2.test.ts`：注入 OCR 引擎后确认页码、低置信度状态与可检索结果；本机已检测到 Tesseract 5.5.2 和 `pdftoppm`，但未将真实 OCR 成功作为测试门。 |
| P2-02 | `chunk_embeddings` SQLite 兼容表保存本地 HashEmbedding 向量；FTS5 与余弦相似度按 0.65/0.35 融合并限制在当前主题。 | `tests/p2.test.ts`：确认向量写入、融合检索和跨主题空结果。 |
| P2-03 | `LocalSandbox` 不使用 shell、临时工作目录、命令 allowlist、超时/输出上限，最小化可读系统路径，并配置 macOS `sandbox-exec` 网络拒绝规则。系统无该工具时返回 `unavailable`。 | `tests/p2.test.ts`：拒绝未授权命令、真实 `/etc/hosts` 文件读取拒绝和缺少系统 sandbox 的安全降级；网络拒绝仍未做独立探针。 |
| P2-04 | `LocalSyncServer` 仅监听 `127.0.0.1`，以经校验的 topic path 提供 progress JSON 与 SSE，并按 topic 维护订阅者集合。CLI 使用 `启动同步服务 [port]` 启动并在每个 Run 后发布 progress。 | `tests/p2.test.ts`：真实 loopback HTTP/SSE 订阅、事件发布与未知主题 404。 |

运行限制：本机 OCR 依赖 `tesseract` 与 `pdftoppm`。Docker/Colima 已卸载，P2 不依赖 Docker。真实 Provider smoke 仍为可选环境验收；当前外发策略与范围见 `SECURITY.md` 和 `CONFIGURATION.md`。
