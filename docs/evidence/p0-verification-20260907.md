# 三项 Agent 架构目标核验

> 历史验收快照：下文的测试数量、失败、安装及“待验”状态仅适用于记录当次执行；未重新运行或改写历史结果。当前实现与后续进展见 [当前状态](../current-status.md) 和 [证据索引](README.md)。

日期：2026-09-07。产品源码基线：`793ed38`。本次任务仅检查，不修改产品实现。

工作区原有的 README.md、learning-outcomes-20260907.md 改动保留，不属于本次核验修改。

## 验收口径

本报告检查最近一次架构分析列出的三项 P0：统一执行内核；完整保存执行过程与可靠续接；防循环与自主修复闭环。这些名称不能混同 TASKS.md 中历史 MVP 的 P0 编号。

同时核对原 P11/P12 交付范围，避免用新增要求追溯否定历史成果：

- `9c4c901`：共享应用服务、受控模型/工具循环、目标、排队、纠正、停止和手动恢复。
- `13b88f0`：持久步骤/实际操作、幂等保存、完整性校验、失败重试及审批交互。
- 原验收：[P11 计划](../agent-upgrade-plan.md)、[P12 计划](../agent-next-plan.md)、[P11 证据](agent-upgrade.md)、[P12 证据](agent-next.md)。

| 项目 | 已验证的既有能力 | 最近提出的完整目标 | 判定 |
| --- | --- | --- | --- |
| P0-1 统一执行内核 | CLI 和桌面复用 LearningApplication、collectInvocation、ToolHarness；相关既有测试通过 | 会话调度、事件、纠正、审批与恢复由同一个 Agent 服务管理 | 部分完成；共享底层成立，统一会话执行服务尚未形成 |
| P0-2 完整过程与续接 | 审批卡重启后可用、批准后同一 taskId；真实进程崩溃后幂等保存不重复 | 原工具调用链持续保存；纠正保留任务身份；在执行边界精确恢复 | 部分完成；现有操作级恢复成立，协议级续接未完成 |
| P0-3 防循环与自主修复 | 重复调用/轮次限制；操作单独重试；真实操作更新计划状态 | 同一次任务测试失败、修改实现、再次测试；处理未完成执行计划 | 闭环未完成；重测被阻断，未完成计划不会驱动自动继续 |

“部分完成”描述当前较高目标的覆盖情况，不表示已有能力不存在，也不意味着需要推倒重写。

## 源码与调用路径

- CLI 自然工具问答：`src/cli.ts` → `runLearningAgent` → `collectInvocation` → `ToolHarness`。教学和输入管理仍在 CLI 路径中。
- 桌面：`DesktopService.generate` → `runAssistantTask` → `collectInvocation` → `ToolHarness`；队列、审批、上下文整理由 DesktopService 管理。
- `desktop/core/service.ts` 的 `resolveInteraction` 执行已批准的工具，把结果变成新用户消息，再通过 `send` 发起新请求并保留 `resumeTaskId`。
- `enqueue` 保存的队列项不携带旧任务 ID；`drain` 调用 `send` 时不传 `resumeTaskId`，因此纠正输入获得新任务 ID。
- `src/model-invocation.ts` 的 `history` 是调用内存变量，暂停时退出循环。没有用于进程恢复的完整工具转录检查点。
- `src/loop-guard.ts` 用工具名和规范化参数去重，不考虑两次请求之间产物是否变化。
- `runAssistantTask` 返回真实 `taskCompleted`，但是否结束模型循环不以计划完成为条件；桌面区分消息状态和 `taskCompleted` 提示。

## 本次实际验证

模型响应使用脚本化夹具，不调用远端模型。学习应用、工具执行、SQLite、文件保存和 macOS 实验沙箱使用真实实现。所有资料、代码和数据库都是新建临时合成工作区，结束后清理。

### 既有定向测试

```bash
npm exec -- vitest run tests/desktop-service.test.ts tests/desktop-tasks.test.ts tests/desktop-interactions.test.ts tests/task-execution.test.ts tests/model-invocation.test.ts tests/loop-guard.test.ts tests/learning-agent.test.ts tests/learning-agent-cli.test.ts tests/interaction-protocol.test.ts tests/workflow-ledger.test.ts tests/evidence-application.test.ts
```

退出码 0：11 个测试文件，55 个测试通过。

这些测试验证了已有交付，但边界较窄：原纠正测试检查旧目标与新要求的文字，没有断言 taskId；原审批测试明确预期暂停后调用新的 stream；重试测试针对 TaskExecutionStore，不覆盖完整模型循环中的修复与重测。

### 新增可复现核验

```bash
node --import tsx scripts/audit-agent-p0.ts
```

退出码 1：8 项标准中 4 项满足、4 项未满足。该脚本是独立验收探针，不加入常规 CI；退出 1 明确表示尚有验收缺口，退出 2 表示探针或运行环境异常。需要现有已验证的 macOS 沙箱；其他平台会报告环境不满足。

| 核验 ID | 实际观测 | 结果 |
| --- | --- | --- |
| approval_restart_same_task | 关闭旧应用服务/数据库并重新打开后批准：taskId 相同，产物 1 份，回答 completed | 满足 |
| approval_preserves_tool_continuation | 批准后新调用 stream 1 次，continue 0 次，历史工具轮次 0；执行结果进入 user 消息 | 未满足 |
| steering_preserves_task_and_operations | 已保存产物后纠正：taskId 改变；旧任务有 1 条操作，新任务为 0 条；新回答 completed | 未满足 |
| save_recovers_after_process_kill | 子进程保存产物后、提交操作结果前被 SIGKILL；重开时操作 running，重试后 completed；仍为同一产物 ID、1 份产物 | 满足 |
| agent_repairs_and_retests_in_one_run | 真实测试首次退出 1；模型保存修正实现；第二次相同参数测试未执行；回答 failed；实际测试操作仅 1 条 | 未满足 |
| operation_retry_after_repair | 在同一工作区、同一任务中通过应用工具再次运行修正后的实现：实际退出 0 | 满足 |
| unfinished_plan_prevents_unqualified_completion | 模型建计划后直接声称完成：消息 completed，计划 false、操作 0 条，UI 的 taskCompleted 仍为 false | 未满足 |
| task_completion_uses_actual_operation | 模型建计划并真实保存对应产物后：消息 completed，计划 true，操作 1 条 | 满足 |

重测场景使用初始实现 `answer = 41`、测试要求 `answer = 42`，之后保存 `answer = 42`。完整 Agent 路径失败后，直接经过应用工具的重测成功，确认实验环境和修复代码本身可用。结合模型调用路径中的 LoopGuard 检查，可定位为循环重复检测阻断。上一轮还单独复现过 LoopGuard 返回 `repeated_tool_call`。

需要精确区分：未完成计划场景没有把数据库计划或学习进度伪造为完成，界面也有未完成提示。未满足的是新目标中的自动继续或阻塞处理机制，不能将其表述为“程序已经错误认证任务/学习完成”。

### 检查脚本类型验证

```bash
npm exec -- tsc --noEmit --target ES2023 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck scripts/audit-agent-p0.ts
```

退出码 0。根目录现有 tsconfig 不包含 scripts，因此单独执行该检查。

### 完整既有质量门

```bash
npm run verify
```

退出码 0：lint、根目录及桌面类型检查、79 文件 / 359 个测试、integration 9 项、eval 6 项、隔离 mock smoke、敏感内容扫描和 diff 空白检查全部通过。这些是本次实际重跑结果。

完整质量门通过与专项核验存在缺口可以同时成立：现有自动测试没有表达上述完整目标，独立验收探针保留退出码 1，不能把常规 verify 通过作为三个目标均已完成的结论。

## 边界与后续范围

- 审批重启探针重新创建服务和数据库，不声称完成了整个 Electron 进程崩溃测试。
- SIGKILL 探针真正结束子进程，但只覆盖“产物及元数据保存成功、操作结果未提交”的一个崩溃窗口；没有证明所有文件写入边界、非幂等工具或全部模型协议状态均可恢复。
- 纠正探针证明操作账本不随原 taskId 延续；旧文件和旧任务仍在，不意味着数据被删除。新模型有可能自行重新查询，但运行时不提供原任务身份的保证。
- 模型输出为确定性夹具，未测试真实模型决策质量、远端重连或真实 Provider 的续接协议；本次未运行 Electron UI 或重新打包。
- 应优先补齐“修复后重测”这一已有执行链路中的缺陷。统一会话服务、协议级恢复与完成控制分别作为有明确新增验收条件的增量工作，不能再打包成重复建设三个大模块。
- 本次新增核验脚本和证据报告，不修改历史勾选状态，不执行实现修复或提交。
