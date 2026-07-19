# 配置

## 运行时

| 项目 | 说明 |
| --- | --- |
| Node.js | 固定 `24.8.x` |
| `ZHIXING_ROOT` | 可选。指定隔离的数据根目录，测试使用它避免污染工作区。 |
| `ZHIXING_ALLOW_LIVE_PROVIDER=0` | 可选。显式禁用真实 Provider，强制本地模式。默认允许已配置 Provider。 |
| `zhixing/settings/model-routing.local.json` | CLI 持久化的角色到 Provider 路由；不含密钥，首次切换后创建。 |
| `zhixing/settings/current-topic.local.json` | CLI 保存的当前主题；`学习 <主题>` 或自然计划成功后更新，重启 REPL 自动恢复。 |

API Key 不写入仓库、日志或 `.env`；macOS 使用系统 Keychain。不要提交 `data/`、`db/`、`inbox/`、`learning-notes/` 中的用户资料。

当前内置 Provider 为 `mock`、`deepseek-api` 与 `codex-cli`。DeepSeek Key 通过 `模型添加 api-key deepseek-api` 的隐藏输入写入 macOS Keychain；Codex 复用用户已登录的官方 CLI，不读取登录凭证。角色默认均路由到 `mock`，执行 `模型切换 <角色> <provider> --确认` 后保持该本地路由，直至再次切换。

真实 Provider 默认可用；如需强制本地模式，请在发起命令的终端设置 `ZHIXING_ALLOW_LIVE_PROVIDER=0`。`资料问答` 会发送检索证据；`学习建议` 只发送学习画像与资料文件名；教学/答疑/练习发送当天学习卡、受限主题画像、相关记忆、资料名称与必要对话；自然交互发送当前会话文本。模型只能提出经过 schema 校验的草案，CLI 才会在“直接运行”后执行白名单动作；导入、删除、恢复和模型切换还需要一次明确确认。使用 `codex-cli` 时，知行启动官方 `codex exec` 的只读、临时、无审批调用；这与终端 smoke 使用相同的稳定表面，不读取、保存或转发 Codex 登录凭据。Codex 教学调用上限为 150 秒，DeepSeek SSE 调用上限为 60 秒。REPL 在模型调用开始时显示进度提示，并会转发 CLI 的文本输出。

## 本地 OCR 与同步

- OCR：需要 `tesseract` 和 `pdftoppm` 在 `PATH` 中；不可用时扫描 PDF 保留为 `ocr_required`。
- 同步：`启动同步服务 [port]` 仅监听 `127.0.0.1`，提供 `/topics/<topicId>/progress` 与 `/topics/<topicId>/events`。
- Docker/Colima 不是运行依赖。
