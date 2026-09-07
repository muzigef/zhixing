# 三项 P0：恢复边界与异步取消的继续核验

2026-09-07，用户要求“继续核实”。本轮沿用[冻结标准](../p0-agent-kernel-plan.md)，以[上一轮 400 项测试的契约核查](p0-contract-audit-20260907.md)为基线，没有重新开发三项 P0，也没有扩大产品范围。

## 复现与修复

| 对应目标 | 修复前实际复现 | 本轮修复 |
| --- | --- | --- |
| P0-1：共享会话生命周期 | session/settled 订阅回调抛错导致 send/idle 异常；delta 回调抛错把正常回答改成 failed。启动阶段还可能留下 active 状态 | 单独隔离并移除失败的订阅者，兼容同步异常和异步拒绝；其他订阅者继续收到事件，任务可完成，同一入口及另一入口可以继续使用会话 |
| P0-2 / P0-3：纠正后的再次恢复 | 旧调用被纠正取消、随后模型请求失败；再次恢复时，未执行的旧调用被当成已执行，合法同参数新调用触发 repeated_tool_call | 检查点保存由 Runtime 写入的 dispatch 标记；只有明确 not_started 的记录不计入已执行集合，unknown 仍受防循环限制；不能根据工具输出自行声称“未开始”而绕过防护 |
| P0-2：恢复与资源限制 | 已保存批次漏算工具数量和输入体积，降低本次限制后仍执行整个批次；恢复调用和新调用分开计数，允许多执行；大结果挤满上下文后仍执行后续工具 | 恢复剩余调用与本轮新调用共享预算；分发前计入待执行批次体积，每次后续分发前检查上下文。超限不执行新副作用，保留已返回真实结果和恢复游标 |
| P0-2 / P0-3：取消与完成判定 | 异步完成检查卡住时，取消和超时不能及时返回；最终检查期间取消仍先写入 completed 事件 | 完成检查纳入取消/超时边界，并接收同一 AbortSignal；返回后再次检查取消，再允许写入完成状态 |
| P0-3：实际完成状态的并发更新 | 较早开始的异步核验发现旧结果失效时，整份旧计划覆盖新增步骤、新标题或刚完成的新操作；已取消检查仍写回 | 核验信号传到领域校验，取消后拒绝写回；事务内重读最新计划，只使仍绑定原操作的步骤失效，不覆盖新增或更新的步骤 |

涉及实现：`src/agent-service.ts`、`src/model.ts`、`src/agent-execution-store.ts`、`src/model-invocation.ts`、`src/task-execution.ts`、`src/application-tools.ts`、`src/assistant-runtime.ts`。

新增或扩展回归：`tests/agent-service.test.ts`、`tests/agent-recovery-boundaries.test.ts`、`tests/task-execution.test.ts`。所有工作区、数据库和内容均为临时合成夹具。

## 实际命令与结果

1. 修复前执行 `npx vitest run tests/agent-service.test.ts tests/agent-recovery-boundaries.test.ts`：退出 1，11 项失败、5 项通过。失败覆盖订阅异常、取消恢复的误拦截、恢复预算和异步完成检查。
2. 发现领域核验写回竞态后，先执行 `npx vitest run tests/task-execution.test.ts`：退出 1，新增 3 项失败、原有 2 项通过；实际观察到新步骤丢失、新完成状态被清除和取消后仍写回。
3. 最小修复后，相关定向回归通过；再补充异步订阅失败和执行结果未知的反向保护。最终定向命令为：

   ```bash
   npx vitest run tests/agent-service.test.ts tests/agent-recovery-boundaries.test.ts tests/task-execution.test.ts tests/agent-checkpoint.test.ts tests/agent-contract-edges.test.ts tests/agent-p0-execution.test.ts tests/agent-crash.test.ts tests/model-invocation.test.ts tests/agent-limits.test.ts tests/pi-latency.test.ts tests/deepseek-client.test.ts
   ```

   退出 0，**11 文件 / 94 测试**，包含 Pi/DeepSeek 原生工具协议回归和实际 SIGKILL 恢复。
4. `npm run verify`：退出 0，**86 文件 / 419 测试**；lint、根目录和桌面类型检查、integration 9 项、eval 6 项、mock smoke、敏感扫描、diff 检查通过。全量 Vitest 于本地时间 20:13:02 开始，耗时 33.12 秒。
5. `node --import tsx scripts/audit-agent-p0.ts`：退出 0，**原专项 8/8**。实际应用工具验证审批原生续接、同任务纠正、SIGKILL 后同一产物恢复、真实实验首次 exit 1 后修复重测 exit 0，以及未完成计划的 blocked 状态。
6. `npm --prefix desktop run test:ui`：退出 0，**四组 Electron UI**（基础交互、学习工作区、审批与分支、学习效果流程）全部通过，使用当前源码重新构建的开发应用。包含队列/纠正/停止/恢复、授权、原生回复、备份和主题隔离。

相对于上轮净增 1 个测试文件、19 项用例。原有测试没有跳过或降低断言。本轮没有重复真实模型调用；模型连接与工具协议转换代码未变，真实 Provider 的上一轮合成结果见[原始记录](p0-live-contract-audit-20260907.json)，不能当作本轮实时可用性证明。

## 结论与边界

三项 P0 已有完整实现，原冻结验收和本轮新增故障回归均通过，本轮复现的五类问题已修复。后续核查仍可能发现其他缺陷；419 项测试证明的是这些明确场景，不构成零缺陷、开放任务成功率或与商业 Agent 整体成熟度相当的保证。

资源预算按每次调用计算，恢复时计入尚需分发的工具；已经保存的结果不消耗新的分发次数。历史检查点没有 dispatch 标记时保守参与防循环，显式重试仍可以开始新的有界尝试。取消会阻止晚到的应用完成检查写回；这不等于回滚取消之前已完成并记录的工具副作用。

本轮未验证真实学习者教学效果、长期开放任务稳定性、Windows/Intel 实机、签名公证或新安装包；未提交或推送 Git。README、任务清单、冻结计划、内核说明与测试指南已更新到本轮证据。
