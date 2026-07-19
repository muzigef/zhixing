# 知行架构（当前实现）

> 本文描述仓库当前代码，而不是目标架构。后续设想会明确标注，不能作为已交付能力。

## 运行入口与职责

`src/cli.ts` 是当前组合根：它初始化主题、数据库、资料库、Provider、课程、提醒和 REPL/headless 命令。`LearningRuntime` 负责确定性 Day 状态机、前置条件、进度、计划与证据 Review；模型只用于讲解、答疑、自然语言草案和资料问答，不能直接改变完成状态。

每轮输入先通过 `interaction-protocol.ts` 编译为四类受类型约束的控制决策：确定性命令、待执行计划确认、教学输入或自然输入。确定性命令不需要模型解释；模糊管理请求只能生成校验后的草案；教学输入再进入教学动作协议。内容模型不能直接执行写操作或改变状态。

```text
CLI / REPL
  -> TopicRegistry + TopicStore（内置或用户创建的本地主题）
  -> LearningRuntime（Day gate、进度、Review）
  -> DocumentLibrary + ZhixingDatabase（PDF/Markdown、FTS5、HashEmbedding、记忆）
  -> ProviderRuntime（mock / DeepSeek / Codex）
  -> ActionRegistry / InteractionProtocol（输入分类与命令元数据）
  -> RunManager + WorkflowLedger（取消、单前台任务、SQLite 运行/步骤账本）
  -> AuditLogger（脱敏事件轨迹）
```

## 主题、状态与数据

- 内置主题定义在 `src/topics.ts`；`创建主题` 通过 `TopicStore` 建立受控本地主题、计划、Skill 与 inbox 目录。
- 当前主题保存在 `zhixing/settings/current-topic.local.json`；用户生成主题、学习记录和本地设置均被 `.gitignore` 排除。
- Day 状态、进度和计划由主题目录中的 Markdown/JSON 文件保存；资料元数据、Chunk、FTS5、嵌入与记忆保存在 `zhixing/db/zhixing.sqlite`。
- `TeachingSessionStore` 保存当前 Day、阶段、受限转录、当前练习和作答；`LearningContextBuilder` 仅组装当前主题画像、至多三条记忆、资料名称和教学检查点。
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

资料问答发送检索证据；学习建议发送画像和资料名称；教学发送当天学习卡与受限主题上下文；自然交互发送当前会话文本。凭证、审计原文和其他主题资料不发送。Codex 在临时目录、只读沙箱内运行，知行只读取 assistant 文本增量。

`ProviderRuntime` 在允许 fallback 的调用中可使用 mock；教学和自然交互显式关闭静默 fallback，失败直接展示 Provider 错误。

## 控制面、事件与工具

`ActionRegistry` 为已识别命令声明稳定动作 ID、风险级别与确认要求；`InteractionProtocol` 先把每轮输入归为命令、待执行草案、教学输入或自然输入。共享的 `ConversationPolicy` 统一校验用户授权、高风险显式确认与用户原文证据：模型文本只能提出动作或事实建议，不能单独改变状态、触发批改或写入记忆。CLI 仍是组合根，尚未完全由注册表分派每一个旧命令处理器。

`ModelEvent` 包含 `text_delta`、`tool_call`、`tool_result` 与 `done`。`collectInvocation` 会限制模型流中的最大工具调用轮数和重复调用，并要求受控回调执行工具，且保留受控工具结果。每次调用向同一 Run 审计链写入 Provider、角色、耗时、状态、事件数、模型回合数和工具调用数；prompt、回答、工具参数与结果不进入审计。Provider 可选实现 `ContinuableModelClient` 协议：只有声明该能力的适配器会在工具结果后继续下一模型轮；不支持的 Provider 在单回合安全结束。`ToolHarness` 提供显式注册、Zod 输入校验、主题上下文、强制超时、输出限额和由控制面给出的最大风险授权；旧 `ToolDispatcher` 仅作为兼容适配层并委托同一 Harness。当前教学/自然交互仍按纯文本设计，未向真实 Provider 注册实际工具。

当前没有 token/费用预算、通用并行调度、网络重试、Claude/本地 HTTP Provider、DOCX 导入、云同步或 Web UI。

## 安全与质量

- `PathPolicy` 控制主题路径、导入根与符号链接越界；资料和用户本地状态不得提交。
- API Key 只在 macOS Keychain 中保存，审计仅记录 Provider、角色、耗时与状态，不保存 prompt、回答或凭证。
- 删除资料、写长期记忆和恢复数据库均需命令级确认；恢复会先预校验备份，并在失败时重新打开原数据库。
- 发布质量门是 `npm run verify`；真实 Provider smoke 为可选环境验收。

## 后续设计（未实现）

仍需完成：让所有旧命令处理器都经 Action Registry 分派、为真实 Provider 增加结构化工具续写适配、token/费用预算与端到端故障注入。主题删除、导出、自动备份、跨设备同步和更多 Provider 也应以单独任务与验收实现。
