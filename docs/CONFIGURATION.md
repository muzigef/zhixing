# 配置

## 运行时

| 项目 | 说明 |
| --- | --- |
| Node.js | 固定 `24.8.x` |
| `ZHIXING_ROOT` | 可选。指定隔离的数据根目录，测试使用它避免污染工作区。 |
| `ZHIXING_ALLOW_LIVE_PROVIDER=1` | 可选。允许受控 Provider adapter；资料仍须在命令中显式允许外发。 |
| `zhixing/settings/model-routing.local.json` | CLI 持久化的角色到 Provider 路由；不含密钥，首次切换后创建。 |

API Key 不写入仓库、日志或 `.env`；macOS 使用系统 Keychain。不要提交 `data/`、`db/`、`inbox/`、`learning-notes/` 中的用户资料。

当前内置 Provider 为 `mock`、`deepseek-api` 与 `codex-cli`。DeepSeek Key 通过 `模型添加 api-key deepseek-api` 的隐藏输入写入 macOS Keychain；Codex 复用用户已登录的官方 CLI，不读取登录凭证。角色默认均路由到 `mock`，执行 `模型切换 <角色> <provider>` 后保持该本地路由，直至再次切换。

真实 Provider 还需要在发起命令的终端设置 `ZHIXING_ALLOW_LIVE_PROVIDER=1`。仅 `资料问答 ... --允许外发` 会发送检索证据；`学习建议 --允许外发` 只发送学习画像与资料文件名。

## 本地 OCR 与同步

- OCR：需要 `tesseract` 和 `pdftoppm` 在 `PATH` 中；不可用时扫描 PDF 保留为 `ocr_required`。
- 同步：`启动同步服务 [port]` 仅监听 `127.0.0.1`，提供 `/topics/<topicId>/progress` 与 `/topics/<topicId>/events`。
- Docker/Colima 不是运行依赖。
