# 知行架构（当前实现）

> 本文描述仓库当前代码，而不是目标架构。后续设想会明确标注，不能作为已交付能力。

## 运行入口与职责

`src/cli.ts` 是当前组合根：它初始化主题、数据库、资料库、Provider、课程、提醒和 REPL/headless 命令。`LearningRuntime` 负责确定性 Day 状态机、前置条件、进度、计划与证据 Review；模型只用于讲解、答疑、自然语言草案和资料问答，不能直接改变完成状态。

每轮输入先通过 `interaction-protocol.ts` 编译为四类受类型约束的控制决策：确定性命令、待执行计划确认、教学输入或自然输入。确定性命令不需要模型解释；模糊管理请求只能生成校验后的草案；教学输入再进入教学动作协议。内容模型不能直接执行写操作或改变状态。

```text
CLI / REPL
  -> ReplInput + ReplController + ReplOutput（持续输入、即时控制、串行队列与显示）
  -> ConversationSessionStore（按主题的新对话、历史与恢复）
  -> TopicRegistry + TopicStore（内置或用户创建的本地主题）
  -> LearningRuntime（Day gate、进度、Review）
  -> DocumentLibrary + ZhixingDatabase（PDF/Markdown、FTS5、HashEmbedding、记忆）
  -> ProviderRuntime（mock / DeepSeek / Codex CLI / Pi Codex）
  -> ActionRegistry / InteractionProtocol（输入分类与命令元数据）
  -> RunManager + WorkflowLedger（取消、单前台任务、SQLite 运行/步骤账本）
  -> AuditLogger（脱敏事件轨迹）
```

## 主题、状态与数据

- 内置主题定义在 `src/topics.ts`；`创建主题` 通过 `TopicStore` 建立受控本地主题、计划、Skill 与 inbox 目录。
- 当前主题保存在 `zhixing/settings/current-topic.local.json`；用户生成主题、学习记录和本地设置均被 `.gitignore` 排除。
- Day 状态、进度和计划由主题目录中的 Markdown/JSON 文件保存；资料元数据、Chunk、FTS5、嵌入与记忆保存在 `zhixing/db/zhixing.sqlite`。
- `TeachingSessionStore` 保存当前 Day、阶段、受限转录、当前练习和作答；`LearningContextBuilder` 仅组装当前主题画像、至多三条记忆、资料名称和教学检查点。
- `ConversationSessionStore` 保存每主题当前对话及可显式恢复的旧对话，最近 6 轮、每轮输入与回答各最多 8,000 字符；请求前保存用户输入，结束或正常中断后保存回答。强制结束可能丢失未保存增量，教学检查点不随旧聊天恢复而回滚。
- `WorkflowLedger` 将运行与步骤状态写入 SQLite；启动时会把上次进程遗留的 `running` 运行标记为 `process_interrupted`，不重放任何可能含写入的操作。用户可安全地重新发起操作。
- 当前没有全局 `profile.md`、`MISTAKES.md`、情节记忆、主题删除、自动备份或导出功能。

## 教学闭环

真实 tutor 的单日流程为：`开始第 N 天 → 讲解 → 答疑确认 → 练习/测验 → 实验与证据 Review`。讲解、答疑和练习的检查点在每次成功阶段转换后保存；重启可恢复，但不会恢复未完成的 Provider 请求。练习中的自然语言先被约束为 `start_practice`、`answer_question`、`request_solution`、`ask_question`、`skip_question` 或 `change_plan`。模型分类只提供意图建议：索要答案有确定性优先级；“作答/批改/持久化”必须有可追溯的用户原文证据，未证实的 `answer_question` 会安全降级为答疑，不能触发虚构批改。Day 只有 `检查 DNN --实现 --测试 --失败 --复盘` 达到 reviewer 标准后才会推进。

`mock` 不调用真实模型，返回确定性学习卡；真实 Provider 默认在已配置后可用，设置 `ZHIXING_ALLOW_LIVE_PROVIDER=0` 会阻止调用。

## Provider 与外发边界

| Provider | 当前适配 | 流式/超时 |
| --- | --- | --- |
| mock | 本地 `MockModelClient` | 立即返回 |
| deepseek-api | OpenAI-compatible SSE；Keychain 读取 API Key | SSE，60 秒、网络/超时错误归一、64 KiB 帧限额 |
| codex-cli | `codex exec --sandbox read-only --ephemeral --json` | JSONL 文本流，150 秒 |
| pi-codex | 安全启动器调用 Pi；继承 Pi 默认 Codex 模型与推理强度 | JSON 文本增量，150 秒 |

资料问答发送检索证据；学习建议发送画像和资料名称；教学发送当天学习卡与受限主题上下文；自然交互发送当前会话文本。凭证、审计原文和其他主题资料不发送。Codex 在临时目录、只读沙箱内运行，知行只读取 assistant 文本增量。

`ProviderRuntime` 在允许 fallback 的调用中可使用 mock；教学和自然交互显式关闭静默 fallback，失败直接展示 Provider 错误。

## 控制面、事件与工具

`ActionRegistry` 为已识别命令声明稳定动作 ID、风险级别与确认要求；`InteractionProtocol` 先把每轮输入归为命令、待执行草案、教学输入或自然输入。共享的 `ConversationPolicy` 统一校验用户授权、高风险显式确认与用户原文证据：模型文本只能提出动作或事实建议，不能单独改变状态、触发批改或写入记忆。CLI 仍是组合根，尚未完全由注册表分派每一个旧命令处理器。

`ModelEvent` 包含文本、工具请求、工具结果与终止事件；工具请求带 `callId`。模型发出的 `tool_result` 不可信，只有控制面实际执行的结果会进入续写。`collectInvocation` 在单个调用内持有完整的模型/工具历史，固定 Provider 路由，并在收到整个合法工具批次后顺序执行。工具失败作为结构化观察反馈，模型可以调整下一步；未知工具和写权限不因模型要求而开放。

DeepSeek 实现 `ContinuableModelClient`：工具 schema、分片参数、assistant tool_calls 和 tool_call_id 成对传输，连续多次检索不会丢失早期轮次。普通自由问答在 Provider 支持工具时，以及显式 `学习助手` 命令，通过同一个 `ToolHarness` 注册进度、资料目录与按次授权的资料正文检索；每次调用保持当前主题不变。原有教学和自然计划协调器仍走文本协议，Codex CLI 与 Pi Codex 均为文本适配器。

REPL 持续读输入，普通消息串行执行，状态与取消即时响应，显式调整可抢占文本生成。短段落定时刷新；正在编辑输入时暂存新增显示。隐藏输入独占来源，不将其缓存重放进聊天。该界面仍是行式终端，未实现完整 TUI。

默认预算为 6 个模型回合、32 次工具请求、10,000 个事件、64,000 字符总文本、128,000 字符上下文估算和 180 秒总时限。超过预算明确停止；这不是 tokenizer 精确计数，也不是费用预算。SSE 按 UTF-8 字节限制单帧 64 KiB、整响应 256 KiB，支持 CRLF 和跨块分片；`[DONE]` 立即关闭读取，断流、坏帧和截断输出不报成功。取消约束覆盖取密钥、HTTP、流读取、工具 dispatch 和下一模型轮。

教学转移由 `completeTeachingTurn` 在模型成功返回后计算。索要答案、批改和澄清不会覆盖原练习；新出题才增加轮次，仍保留原有 20 轮上限。部分回答可保留为未完成转录，但不推进阶段或写入学习者作答。转录保存前有明确截断标记；切换主题时清除旧主题的内存对话和待确认草案。

当前没有精确 token/费用计量、语义上下文压缩、通用并行调度、网络重试、Claude/本地 HTTP Provider、DOCX 导入、云同步或 Web UI。

## 安全与质量

- `PathPolicy` 控制主题路径、导入根以及现存父目录/中间目录/叶子文件符号链接越界；它不代替防并发路径替换的 OS 沙箱；资料和用户本地状态不得提交。
- API Key 只在 macOS Keychain 中保存，审计仅记录 Provider、角色、耗时与状态，不保存 prompt、回答或凭证。
- 删除资料、写长期记忆和恢复数据库均需命令级确认；恢复会先预校验备份，并在失败时重新打开原数据库。
- 发布质量门是 `npm run verify`；真实 Provider smoke 为可选环境验收。

## 后续设计（未实现）

仍需完成：让所有旧命令处理器都经 Action Registry 分派、为其他 Provider 增加知行工具适配、精确 token/费用预算、持久任务的逐步骤幂等恢复和语义压缩。主题删除、导出、自动备份、跨设备同步和更多 Provider 也应以单独任务与验收实现。

`PiCodexClient` 读取非敏感模型偏好，显式指定 Provider、模型与推理强度，避免 Pi 默认模型不可用时自动选到其他 Provider。安全启动器保留守卫，模型通道禁用全部工具；认证仍属于 Pi。Pi JSON 的 assistant `text_delta` 映射为知行文本事件，最终 assistant 与 `agent_end` 以及进程退出共同决定完成状态，单纯退出码 0 不等于模型成功。
