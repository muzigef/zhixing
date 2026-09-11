<!-- generated-by: gsd-doc-writer -->
# 知行 Agent：结合代码的架构讲解

核对日期：2026-09-11。本文从一次用户输入开始，说明知行如何把自然语言、模型调用、受控执行、持久化状态和审计组合成一个可恢复的学习 Agent。当前有两个入口：CLI 提供完整学习工作流，桌面提供连续任务和学习工作区；两端经 AgentService 共享会话运行、工具检查点、审批、纠正与恢复，经 LearningApplication 共享课程、资料、进度与证据。

## 总体链路

```text
CLI 输入 → REPL 队列与控制命令 → cli.ts
  ├─ 确定性命令 → 授权检查 → 学习 Runtime / Store
  ├─ 普通问答 → CliAgentTransport → AgentService → 模型/工具循环
  ├─ 教学输入 → 用户作答核对 → 教学检查点
  └─ 计划请求 → JSON 草案 → 用户确认 → 白名单命令

桌面输入 → React → preload → 主进程 IPC 校验
  → DesktopService（AgentService 兼容导出）→ 共享 AgentBackend（API / Pi / 官方订阅 / 离线演示）
  → 文本事件 → React 渲染 + 独立 JSON 会话
```

核心分工是：模型负责理解、讲解和提出建议；程序负责权限、真实状态变化、工具执行和可验证性。

## 1. CLI 入口负责接入与编排

入口是 [`src/cli.ts`](../src/cli.ts)。它同时组装 Provider、Store、数据库、受控命令处理和自然对话，仍是一个较大的编排文件。`src/agent-service.ts` 负责模型任务生命周期与持久队列，`src/repl-controller.ts` 保留本地命令排队与终端控制，`src/repl-input.ts` 管理多行输入与终端显示，`src/conversation-routing.ts` 再将自然语言分到普通回答、教学或计划。

`src/interaction-protocol.ts` 中的 `decideInteraction` 返回受类型约束的 `InteractionDecision`。以下为分支的简化说明，不是可直接运行的源码：

```text
确认待执行草案 → execute_pending（携带是否强确认）
ActionRegistry 识别的命令 → command（携带动作 ID/确认要求）
教学模式中的其他输入 → teaching_input
其余白名单命令或自然输入 → command / natural_input
```

因此，`开始第 1 天` 等已知操作不依赖模型猜测；“帮我制定学习计划”进入计划分支，而“解释注意力，举个例子”直接进入回答分支，不要求先填写学习画像。即使已经有草案，明确的问题也可以继续回答，不必一直停留在计划确认流程。

## 2. 计划请求生成草案，普通问答直接回答

只有计划/管理分支要求模型返回 `conversationPlanSchema` 能校验的 JSON。以下以已存在的 `agent-development` 主题为例；`goal` 和 `level` 与时间字段一样是必填项：

```json
{
  "kind": "proposal",
  "topicId": "agent-development",
  "summary": "为 Agent 开发制定学习计划",
  "actions": [
    {
      "type": "set_learning_profile",
      "goal": "实现一个有工具调用和测试的学习 Agent",
      "level": "了解 TypeScript，首次实践 Agent",
      "dailyMinutes": 120,
      "totalDays": 84
    },
    { "type": "generate_custom_course" }
  ]
}
```

程序使用 [`conversationPlanSchema`](../src/intent-parser.ts) 校验输出，允许 `clarify` 或最多 5 个动作的 `proposal`，再存入进程内的 `pendingConversationPlan`。新主题还需要匹配的“创建主题”命令，并满足真实 Topic schema；不能只写一个陌生 ID 就保存画像。

用户确认后，`cli.ts` 的 `execute_pending` 分支才保存画像、生成并启用课程，或调用 `executeConversationCommand` 执行白名单命令。草案不持久化、不在重启后自动重放；多个动作也不是跨所有文件的原子事务，因此不能把“有授权”理解成“任意失败都会整体回滚”。

## 3. Conversation Policy 是统一的授权边界

[`src/conversation-policy.ts`](../src/conversation-policy.ts) 的 `authorizeConversationTransition` 检查模型提议、显式确认与用户证据。以下是两个真实检查分支的摘录：

```ts
if (input.requiresUserEvidence && !input.hasUserEvidence) {
  return { allowed: false, reason: "user_evidence_required" };
}
if (input.requiresExplicitConfirmation && !(input.explicitlyConfirmed ?? input.userConfirmed)) {
  return { allowed: false, reason: "user_confirmation_required" };
}
```

模型提议的写入需要用户确认；删除、恢复、模型切换及草案中的资料导入等操作还需要强确认。“用户已经作答”必须有用户原文证据。直接的低风险用户命令不一定再弹出确认，例如“创建主题”或“导入资料”本身就是请求；不能笼统地说所有写操作都必须再加 `--确认`。

这层是会话策略，不是系统级沙箱。资料路径隔离由 `PathPolicy` 等受控接口负责，Pi 工具守卫另在子进程侧执行，桌面 IPC 也有自己的校验边界。

## 4. 教学对话：分类模型不能伪造用户作答

[`src/teaching-dialogue.ts`](../src/teaching-dialogue.ts) 处理教学会话的动作解释。“给答案”“只给提示”“来一道题”先走 `resolveTeachingInput` 的确定性判断。该函数内部的 `direct` 辅助函数返回：

```ts
{
  action: { action: "request_solution", target: "current" },
  hasVerifiedSubmission: false,
  source: "deterministic_request"
}
```

明确的短答案、选项及“我的答案是……”可以直接核对为用户提交；只有模糊输入才调用分类模型。模型分类结果若为 `answer_question`，还需 `recordsLearnerAttempt` 核对其引用的 `learnerAnswer` 确实出现在用户原文中。即使分类器把索要答案误标成作答，也不能凭空产生练习记录。

这使模型分类只提供建议，不能凭空制造用户答案。`src/teaching-turn.ts` 的 `completeTeachingTurn` 还要求本轮生成完整，才增加练习轮次或保存新的作答记录；中断答案不会推动这些完成状态。

产品教学流程可以这样理解；它不是数据库中逐项对应的枚举：

```text
讲解 → 答疑 → 用户确认无疑问 → 练习 → 作答/请求答案 → 批改 → 实验与证据 → Review
```

实际 `teaching-session-contracts.ts` 的 `stage` schema 是 `answer_questions | practice | reflection`，在 `ChatSession.teaching` 中保存 `currentExercise`、`learnerAttempts`、`quizRound` 和最近 `transcript`。学习日的完成另由 `LearningRuntime.reviewDay` 与 `reviewEvidence` 判断；当前 CLI/桌面经 EvidenceStore 重新读取实际产物并验证哈希；布尔标志不计入证据。用户测试报告标为未复跑，另有显式 macOS JS 沙箱测试入口。

## 5. Tool Harness 是真实执行的能力边界

[`src/tool-harness.ts`](../src/tool-harness.ts) 规定工具的输入 schema、风险、超时、幂等性声明和执行函数。下面是 `ToolDefinition` 字段的结构示意，不是完整实例：

```ts
{
  name,
  input,       // Zod schema
  risk,        // read | write | destructive
  timeoutMs,
  idempotent,
  execute
}
```

执行时校验注册、主题边界、风险和 schema，并通过 `AbortSignal` 控制等待时限与取消，结果采用约 11,000 字符正文/12,000 字符外层信封预算，保留执行状态；大结果按任务有界归档，并可用 `read_tool_result` 续读。`idempotent` 是声明字段，不代表自动实现跨请求去重；底层操作仍需配合取消信号。

当前 CLI 与桌面普通对话均通过 `AgentService → runAssistantTask` 创建共享应用工具；`learning-agent.ts` 保留早期受控学习循环。`learning_progress`、`list_materials`、`search_materials` 等查询受学习资料授权及按需工具目录约束，项目和 MCP 分别授权。授权写入走同一工具审批与实际结果链，不由模型自行取得权限。

`collectInvocation` 会先校验完整模型回合，再执行该回合的工具请求。`DeepSeekClient.continue` 携带完整 assistant/tool 历史及 call ID 继续生成，调用期间固定 Provider，不因设置改变而转交另一模型。普通 ModelClient 预算包括最多6回合（开放项目工具时12回合）、32次工具请求和180秒总时限，工具失败作为结果返回模型；已经产生文本或工具事件后不能拼接 mock 回答。两个入口的 Pi SDK、DeepSeek、Kimi 及声明支持工具的自定义 API 都可走该协议。`native-codex` 和 `native-claude` 走独立 `AgentExecutor`，当前只接受上下文文本，不暴露工具/图片；CLI 的旧 `codex-cli` 路由已映射到官方 Codex 执行器。

## 6. Workflow Ledger 提供可恢复性

[`src/workflow-ledger.ts`](../src/workflow-ledger.ts) 持久化 CLI 受控 run 及其步骤。接口形状如下，省略了类型与可选 detail 参数：

```ts
begin(runId, topicId, actionId, command)
step(runId, stepId, "started" | "finished" | "failed")
finish(runId, "completed" | "failed" | "cancelled", errorCode)
```

CLI 重启时，`reconcileInterrupted` 会将遗留的 `running` run 改为 `failed`，错误码为 `process_interrupted`，不会自动重放未知副作用。重试是新的、可审计操作。哈希包含主题、动作、命令及 run ID，因此重复同一命令不会被永久去重；原命令正文不直接写入 ledger。

完整会话由共享 `AgentSessionStore` 保存，CLI 的 `ConversationSessionStore` 最近 6 轮只是兼容投影，可用 `/resume` 恢复。教学检查点属于 `ChatSession.teaching`，恢复旧聊天读自己的练习现场，不倒退独立共享的课程进度。桌面和 CLI 的模型任务经共享 Runtime 写入 WorkflowLedger；会话 JSON 仍位于各入口独立目录。

## 7. Provider Runtime 可替换且可观测

CLI 通过 [`collectInvocation`](../src/model-invocation.ts) 发起有界请求；tutor 可选择离线、Pi、内置/自定义 API 或官方 Agent。逐轮模型使用 ProviderRuntime；原生执行器在 ProviderRegistry 中单独注册，不经过普通模型 stream 或 fallback。以下调用形状中的 Provider、prompt、回调与 signal 由 CLI 创建，`confirmed` 来自控制层而不是模型输出：

```ts
collectInvocation(providers, {
  role: "tutor",
  providerId: "routed",
  prompt,
  containsUserMaterials: true,
  confirmed: liveProviderConsent,
  allowFallback: false,
  onText: streamed,
  onAudit: record => lifecycle.model(
    record.providerId, record.role, record.durationMs, record.status, record
  )
}, signal)
```

`beginLiveModelText` 用 `onText` 在 REPL 中输出 Provider 的增量文本。是否真正 token 级流式取决于底层 Provider；应用层不会把一次性返回伪装成流。

Pi 主对话使用公共 SDK worker，任务绑定时固定实际模型、连接和思考档位，不因任务中途修改偏好而换模型。旧 `PiCodexClient` 的安全启动器保留兼容用途。公共 worker 只运行模型，知行 ToolHarness 执行受控应用工具。认证与刷新由 Pi 自己处理；读到偏好不代表登录成功。DeepSeek 使用 API Key 与 SSE，CLI 从 macOS Keychain 取用 Key。`ZHIXING_ALLOW_LIVE_PROVIDER=0` 会拒绝真实 Provider 请求，但不阻止本地 mock 路由的材料流程；它不自动把失败调用变成本地回答。

## 8. 桌面在主进程调用共享服务

[`desktop/renderer/index.tsx`](../desktop/renderer/index.tsx) 负责消息列表、草稿、Markdown/数学渲染、停止和重试。渲染器通过 sandboxed preload 的 `window.zhixing` 桥接调用主进程，不直接读文件、启动进程或取得 API Key。

[`desktop/electron/main.ts`](../desktop/electron/main.ts) 检查 IPC 来源窗口、主 frame、URL 和 Zod 命令，再把发送操作交给 `DesktopService`：

1. 校验输入和单一活跃生成约束，固定本次 Provider 客户端。
2. 组合当前问题和最多 24 条、约 40,000 字符预算的目标和历史摘录，并加入独立约束/摘要及授权学习上下文。
3. 先保存用户消息和 `running` 回答，再经共享 Runtime 执行 ModelClient 的模型/工具循环，或 AgentExecutor 的官方仅上下文任务。
4. 把增量按会话 ID 发给 React，周期保存部分文本。
5. 正常完成、停止或失败时保存最终状态；重启后未完成的 `running` 消息显示为 `interrupted`。

`DesktopStore` 把每个会话完整保留到独立的系统应用数据 `Zhixing/conversations/`，上限为 20,000 条消息；旧历史每 250 条保存为哈希校验片段，完整会话合计仍限 12 MB；并把 Provider/风格/主题保存到 `preferences.json`。发送给模型的裁剪不会删掉界面中的旧消息。桌面 Pi 内附运行时使用 `Zhixing/runtime/` 作为项目目录，不能假定继承开发仓库的 `.pi/settings.json`。

设置里的 DeepSeek、Kimi 及自定义连接 Key 按连接身份经主进程用 Electron 系统加密保存，macOS 上还可复用旧 CLI Keychain 项。状态查询不回传 Key。切换 Provider 影响后续请求；Pi 失败时“切换到 DeepSeek 重试”由用户触发，保留原会话与失败记录，不自动降级。

## 9. 测试对应的工程保证

- `tests/interaction-protocol.test.ts`：输入分类与确认策略。
- `tests/teaching-dialogue.test.ts`：请求答案不能被记为用户作答。
- `tests/tool-harness.test.ts`：白名单、风险、超时、schema 和输出限制。
- `tests/workflow-ledger.test.ts`：run、step、失败恢复和诊断。
- `tests/provider-runtime.test.ts`：Provider 调用和运行时行为。
- `tests/cli-workflow.test.ts`：从 CLI 输入到学习工作流的集成验证。
- `tests/model-invocation.test.ts`、`tests/deepseek-client.test.ts`：工具反馈、协议结束、预算、取消及失败边界。
- `tests/pi-client.test.ts`、`tests/pi-cli.test.ts`：Pi 配置选择、文本协议、启动和错误处理。
- `tests/repl-controller.test.ts`、`tests/repl-input.test.ts`：输入队列、停止、调整及终端输入。
- `tests/desktop-service.test.ts`、`tests/desktop-storage.test.ts`、`tests/desktop-providers.test.ts`：桌面对话生命周期、存储和模型切换。
- `desktop/scripts/smoke.mjs`：隔离目录中的真实 Electron UI 检查，包括草稿、停止、复制/导出、数学、输入法及设置恢复。

这些测试不等于所有真实 Provider 已连通或所有平台已验收。2026-09-11 三家最小真实检查及本机七组实包 UI 见[通用架构验证](evidence/provider-architecture-20260911.md)，更早平台结果属于其各自构建。源码验证、本机实包验证、远端 CI 与教学效果分别记录；本篇不新增真实调用证据。

## 面试总结

知行的重点不在于“让模型回答得像老师”，而在于让模型出现误判、超时或中断时，系统仍保持正确的权限边界、状态一致性、审计能力与恢复能力。其核心取舍是：让模型提供智能，让代码保持控制权。

历史 0.3 引入 `src/learning-application.ts`、`src/assistant-runtime.ts`、`src/evidence-store.ts`；当前任务队列与摘要调度位于 `src/agent-service.ts`，`desktop/core/service.ts` 只是兼容导出。详细数据边界与测试见 [升级指南](agent-upgrade.md)。

## 共享内核的最新入口

阅读 `agent-service.ts` 的 send/invoke/generate，再读 `model-invocation.ts` 的检查点和工具游标、`agent-execution-store.ts` 的租约与授权决定。`task-execution.ts` 继续负责实际操作去重，`learning-agent-profile.ts` 负责教学提示词。具体恢复边界和限制见 [Agent 内核](agent-kernel.md)。

0.6 新模块的调用关系和实际边界见 [架构增量](architecture.md#06-增量结构与数据契约)，包括权限、教学策略、证据支持、项目恢复、Skill 版本和试验版本追踪。

## 通用接入和团队的代码阅读顺序

先读 `agent-executor.ts` 与 `model.ts` 的两类后端，再读 `agent-model-factory.ts` 的三协议路由，以及 `native-runtime-catalog.ts`、`native-runtime-adapters.ts` 的官方运行时目录/注册。新兼容 API 通过配置接入；新官方运行时需经过审查的适配器及隔离验收，不能把网站订阅凭证直接粘贴成 API Key。

团队顺序为 `team-contracts.ts → team-task-packet.ts → team-coordinator.ts → team-task-graph.ts → team-budget.ts → team-resource-policy.ts`。成员报告是候选分析，实际工具回执、逐项审查和最终回答分开记录；主模型最多发起一次定向复核。恢复保留原绑定、累计预算和已完成任务。详见[团队内核](agent-team-kernel.md)。
