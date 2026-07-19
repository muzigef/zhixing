# 故障排查

| 现象 | 处理 |
| --- | --- |
| Node 版本被拒绝 | 使用 Node `24.8.x`，再执行 `npm ci`。 |
| 扫描 PDF 返回 `ocr_required` | 确认 `tesseract --version` 和 `pdftoppm -v` 可运行；否则保留原文件并改用文字 PDF/Markdown。 |
| 没有检索结果 | 确认文件已导入当前 topic，并使用 `资料库` 查看状态；检索默认主题隔离。 |
| `provider_unavailable` | 检查 Provider 是否已配置、Codex CLI 登录态或 DeepSeek Key；设置 `ZHIXING_ALLOW_LIVE_PROVIDER=0` 时拒绝调用是预期行为。 |
| `live_provider_disabled` | 当前终端设置了 `ZHIXING_ALLOW_LIVE_PROVIDER=0`；移除该设置或改用 `mock`。教学和自然交互不会静默降级。 |
| `provider_timeout` 或只有部分讲解 | Codex 的上限为 150 秒，DeepSeek SSE 为 60 秒。检查 CLI 登录态、网络与 Provider 状态；可直接追问“继续刚才的讲解”或切换到其他 Provider。 |
| Codex 没有实时输出 | 先运行 `模型状态` 确认 `tutor -> codex-cli`，再检查本机 `codex exec` 是否可用。知行只渲染 Codex JSON 文本增量；网络降级至 HTTPS 时首段可能延迟。 |
| 同步服务不可访问 | 只允许本机 `127.0.0.1`；检查端口未被占用，使用返回的 URL。 |
| 删除或恢复被拒绝 | 先执行预览，再在命令末尾添加 `--确认`。 |

若 `npm run verify` 失败，先运行对应的单项脚本缩小范围；提交问题时仅提供脱敏输出，不提供资料、数据库、密钥或审计原文。
