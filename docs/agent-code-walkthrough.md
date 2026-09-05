<!-- generated-by: gsd-doc-writer -->
# 知行 Agent：结合代码的架构讲解

本文从一次用户输入开始，说明知行如何把自然语言、模型调用、受控执行、持久化状态和审计组合成一个可恢复的学习 Agent。当前有两个入口：CLI 提供完整学习工作流，桌面提供连续任务和学习工作区；两端经 LearningApplication 共享课程、资料、进度与证据。

## 总体链路

```text
CLI 输入 → REPL 队列与控制命令 → cli.ts
  ├─ 确定性命令 → 授权检查 → 学习 Runtime / Store
  ├─ 普通问答 → 文本 Provider / 只读学习工具循环
  ├─ 教学输入 → 用户作答核对 → 教学检查点
  └─ 计划请求 → JSON 草案 → 用户确认 → 白名单命令

桌面输入 → React → preload → 主进程 IPC 校验
  → DesktopService → Pi Codex / DeepSeek / demo
  → 文本事件 → React 渲染 + 独立 JSON 会话
```

核心分工是：模型负责理解、讲解和提出建议；程序负责权限、真实状态变化、工具执行和可验证性。

## 1. CLI 入口负责接入与编排

入口是 [`src/cli.ts`](../src/cli.ts)。它同时组装 Provider、Store、数据库、受控命令处理和自然对话，仍是一个较大的编排文件。`src/repl-controller.ts` 负责输入排队、停止和中途调整，`src/repl-input.ts` 管理多行输入与终端显示，`src/conversation-routing.ts` 再将自然语言分到普通回答、教学或计划。

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

实际 `TeachingSessionStore` 的 `stage` schema 是 `answer_questions | practice | reflection`，并保存 `currentExercise`、`learnerAttempts`、`quizRound` 和最近 `transcript`。学习日的完成另由 `LearningRuntime.reviewDay` 与 `reviewEvidence` 判断；当前 CLI/桌面经 EvidenceStore 重新读取实际产物并验证哈希；布尔标志不计入证据。用户测试报告标为未复跑，另有显式 macOS JS 沙箱测试入口。

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

执行时校验注册、主题边界、风险和 schema，并通过 `AbortSignal` 控制等待时限与取消，输出最多保留 12,000 字符的有界结果。`idempotent` 是声明字段，不代表自动实现跨请求去重；底层操作仍需配合取消信号。

CLI 普通自由问答在 DeepSeek 路由下会通过 [`src/learning-agent.ts`](../src/learning-agent.ts) 提供 `learning_progress`、`list_materials`，本次允许正文外发时再加入 `search_materials`。这三个工具均为只读；写操作仍回到确定性命令与授权链。

`collectInvocation` 会先校验完整模型回合，再执行该回合的工具请求。`DeepSeekClient.continue` 携带完整 assistant/tool 历史及 call ID 继续生成，调用期间固定 Provider，不因设置改变而转交另一模型。预算包括最多 6 回合、32 次工具请求和 180 秒总时限，工具失败作为结果返回模型；已经产生文本或工具事件后不能拼接 mock 回答。Pi Codex 和 Codex CLI 是文本适配器，不支持这套多轮工具协议。

## 6. Workflow Ledger 提供可恢复性

[`src/workflow-ledger.ts`](../src/workflow-ledger.ts) 持久化 CLI 受控 run 及其步骤。接口形状如下，省略了类型与可选 detail 参数：

```ts
begin(runId, topicId, actionId, command)
step(runId, stepId, "started" | "finished" | "failed")
finish(runId, "completed" | "failed" | "cancelled", errorCode)
```

CLI 重启时，`reconcileInterrupted` 会将遗留的 `running` run 改为 `failed`，错误码为 `process_interrupted`，不会自动重放未知副作用。重试是新的、可审计操作。哈希包含主题、动作、命令及 run ID，因此重复同一命令不会被永久去重；原命令正文不直接写入 ledger。

普通聊天由 `ConversationSessionStore` 另存每会话最近 6 轮，可用 `/resume` 恢复。教学检查点与聊天指针独立，因此恢复旧聊天不会倒退学习日状态。桌面对话使用另一套 JSON Store，不进入 CLI Workflow Ledger。

## 7. Provider Runtime 可替换且可观测

CLI 通过 [`collectInvocation`](../src/model-invocation.ts) 发起有界请求；tutor 可路由到 `mock`、`deepseek-api`、`codex-cli` 或 `pi-codex`。以下调用形状中的 Provider、prompt、回调与 signal 由 CLI 创建，`confirmed` 来自控制层而不是模型输出：

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

Pi 适配器每轮重读全局/项目的模型偏好，显式选择 `openai-codex`，通过受审查启动器运行，无模型工具权限，prompt 经 stdin 传递。认证与刷新由 Pi 自己处理；读到偏好不代表登录成功。DeepSeek 使用 API Key 与 SSE，CLI 从 macOS Keychain 取用 Key。`ZHIXING_ALLOW_LIVE_PROVIDER=0` 会拒绝真实 Provider 请求，但不阻止本地 mock 路由的材料流程；它不自动把失败调用变成本地回答。

## 8. 桌面对话走独立的主进程服务

[`desktop/renderer/index.tsx`](../desktop/renderer/index.tsx) 负责消息列表、草稿、Markdown/数学渲染、停止和重试。渲染器通过 sandboxed preload 的 `window.zhixing` 桥接调用主进程，不直接读文件、启动进程或取得 API Key。

[`desktop/electron/main.ts`](../desktop/electron/main.ts) 检查 IPC 来源窗口、主 frame、URL 和 Zod 命令，再把发送操作交给 `DesktopService`：

1. 校验输入和单一活跃生成约束，固定本次 Provider 客户端。
2. 组合当前问题和最多 24 条、约 40,000 字符预算的目标和历史摘录，并加入独立约束/摘要及授权学习上下文。
3. 先保存用户消息和 `running` 回答，再经共享 collectInvocation 执行选定模型及可用的只读学习工具。
4. 把增量按会话 ID 发给 React，周期保存部分文本。
5. 正常完成、停止或失败时保存最终状态；重启后未完成的 `running` 消息显示为 `interrupted`。

`DesktopStore` 把每个会话完整保留到独立的系统应用数据 `Zhixing/conversations/`，上限为 1,000 条消息；并把 Provider/风格/主题保存到 `preferences.json`。发送给模型的裁剪不会删掉界面中的旧消息。桌面 Pi 内附运行时使用 `Zhixing/runtime/` 作为项目目录，不能假定继承开发仓库的 `.pi/settings.json`。

设置里的新 DeepSeek Key 经主进程用 Electron 系统加密保存，macOS 上还可复用旧 CLI Keychain 项。状态查询不回传 Key。切换 Provider 影响后续请求；Pi 失败时“切换到 DeepSeek 重试”由用户触发，保留原会话与失败记录，不自动降级。

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

这些测试不等于所有真实 Provider 已连通或所有平台已验收。真实 DeepSeek 短请求、Pi 登录限制、Windows/Intel Mac 未验收及系统新 Key 保存覆盖范围见[桌面验证记录](evidence/desktop-app.md)；本篇依据源码说明机制，不新增真实调用证据。

## 面试总结

知行的重点不在于“让模型回答得像老师”，而在于让模型出现误判、超时或中断时，系统仍保持正确的权限边界、状态一致性、审计能力与恢复能力。其核心取舍是：让模型提供智能，让代码保持控制权。

0.3 新增路径：`src/learning-application.ts`、`src/assistant-runtime.ts`、`src/evidence-store.ts`；任务队列/摘要位于 `desktop/core/service.ts`。详细数据边界与测试见 [升级指南](agent-upgrade.md)。
