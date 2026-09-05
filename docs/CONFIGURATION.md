# 配置

## 运行时

| 项目 | 说明 |
| --- | --- |
| Node.js | 固定 `24.8.x` |
| `ZHIXING_DEEPSEEK_MODEL` | 可选。覆盖 DeepSeek 模型名；默认 `deepseek-v4-flash`。当前适配器显式关闭 thinking，按文本和工具调用协议运行。 |
| `ZHIXING_ROOT` | 可选。指定隔离的数据根目录，测试使用它避免污染工作区。 |
| `ZHIXING_ALLOW_LIVE_PROVIDER=0` | 可选。显式禁用真实 Provider，强制本地模式。默认允许已配置 Provider。 |
| `zhixing/settings/model-routing.local.json` | CLI 持久化的角色到 Provider 路由；不含密钥，首次切换后创建。 |
| `zhixing/settings/current-topic.local.json` | CLI 保存的当前主题；`学习 <主题>` 或自然计划成功后更新，重启 REPL 自动恢复。 |

API Key 不写入仓库、日志或 `.env`；macOS 使用系统 Keychain。不要提交 `data/`、`db/`、`inbox/`、`learning-notes/` 中的用户资料。

当前内置 Provider 为 `mock`、`deepseek-api`、`codex-cli` 与 `pi-codex`。DeepSeek Key 通过 `模型添加 api-key deepseek-api` 的隐藏输入写入 macOS Keychain；Codex 复用用户已登录的官方 CLI，不读取登录凭证。角色默认均路由到 `mock`，执行 `模型切换 <角色> <provider> --确认` 后保持该本地路由，直至再次切换。

真实 Provider 默认可用；如需强制本地模式，请在发起命令的终端设置 `ZHIXING_ALLOW_LIVE_PROVIDER=0`。`资料问答` 会发送检索证据；`学习建议` 只发送学习画像与资料文件名；教学/答疑/练习发送当天学习卡、受限主题画像、相关记忆、资料名称与必要对话；自然交互发送当前会话文本。模型只能提出经过 schema 校验的草案，CLI 才会在“直接运行”后执行白名单动作；导入、删除、恢复和模型切换还需要一次明确确认。使用 `codex-cli` 时，知行启动官方 `codex exec` 的只读、临时、无审批调用；这与终端 smoke 使用相同的稳定表面，不读取、保存或转发 Codex 登录凭据。Codex 教学调用上限为 150 秒，DeepSeek SSE 调用上限为 60 秒。REPL 在模型调用开始时显示进度提示，并会转发 CLI 的文本输出。

## 本地 OCR 与同步

- OCR：需要 `tesseract` 和 `pdftoppm` 在 `PATH` 中；不可用时扫描 PDF 保留为 `ocr_required`。
- 同步：`启动同步服务 [port]` 仅监听 `127.0.0.1`，提供 `/topics/<topicId>/progress` 与 `/topics/<topicId>/events`。
- Docker/Colima 不是运行依赖。

`学习助手` 支持当前主题进度与资料目录查询；正文检索额外要求本次命令的 `--允许外发`，不会继承前一轮该标志。其工具续写保持完整 assistant/tool 历史和 call ID，单次调用的路由固定，不会因角色设置改变而中途转交其他 Provider。任何已产生文本或工具事件的 Provider 都不会静默拼接 mock 回答。

## Pi Codex 接入

`模型切换 tutor pi-codex --确认` 让对话使用 Pi 中的 Codex 配置。知行读取 Pi 配置目录（默认 `~/.pi/agent`，可由 `PI_CODING_AGENT_DIR` 指定）的 `settings.json` 与本项目 `.pi/settings.json`，仅选取 `defaultProvider`、`defaultModel`、`defaultThinkingLevel`。项目值优先；默认 Provider 必须为 `openai-codex`，缺少模型时明确报错，不猜测或静默换模型。

每次调用重新解析配置并显式传给 Pi，因此后续在 Pi 修改默认模型或推理强度会作用于下一次知行请求。认证和刷新由 Pi 自己处理；知行不读取认证文件，不保存密钥。配置变更前已开始的请求保持原选择。

调用通过已审查的 `scripts/pi-safe.sh`，使用 `--print --mode json --no-session --offline --no-tools --tools ''`，关闭技能与模板加载，保留项目上下文与守卫。空工具列表覆盖安全启动器原本给开发会话设置的工具列表。`--offline` 禁止启动时的更新等网络操作，不禁止本次模型请求；禁用真实模型仍使用 `ZHIXING_ALLOW_LIVE_PROVIDER=0`。

请求正文通过 stdin 传入，不进入 argv，不被当作 `@file` 参数。适配器只输出文本增量，忽略推理流和累计快照；校验模型身份、模型结束原因、Agent 完成与进程退出码。取消后终止 Pi，必要时强制结束；单次上限 150 秒。Pi stderr 与模型错误原文不传给用户或审计。

当前 `pi-codex` 为文本适配器；不提供知行多轮工具协议，也不复用 Pi RPC 常驻进程。对话历史由知行会话 Store 保存，Pi 不另外保存每次子调用。

若知行提示 Pi 无法使用当前 Codex 登录信息，通过 `./scripts/pi-safe.sh` 进入 Pi，执行 `/login` 并选择 OpenAI Codex，按 Pi 提示完成认证后重试。已保存模型偏好或模型出现在列表中，不代表当前调用一定能取得有效认证。无需把登录信息复制给知行。
