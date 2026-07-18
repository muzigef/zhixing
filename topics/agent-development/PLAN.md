---
topicId: agent-development
title: Agent 开发学习
version: 1
prerequisites: []
days:
  - id: D01
    title: Agent 契约与状态边界
    estimatedMinutes: 240
    requiredEvidence: [implementation, test-output, failure-case]
    optional: false
  - id: D02
    title: 受控工具与运行生命周期
    estimatedMinutes: 240
    requiredEvidence: [implementation, test-output, failure-case]
    optional: false
  - id: D03
    title: Eval、审计与失败恢复
    estimatedMinutes: 240
    requiredEvidence: [implementation, test-output, failure-case, reflection]
    optional: false
---

# Agent 开发学习

## D01：Agent 契约与状态边界

实验卡：为一个学习工作流定义输入、输出、状态转移和最小测试。

失败案例：提交一次非法状态转移，验证它被拒绝且旧状态保持不变。

证据模板：实现位置、测试输出、失败输入与拒绝结果。

## D02：受控工具与运行生命周期

实验卡：为一个只读工具加入 allowlist、主题范围与取消信号。

失败案例：尝试越过主题边界或重复调用工具，验证 Runtime 停止并记录原因。

证据模板：工具契约、边界测试、审计事件和停止原因。

## D03：Eval、审计与失败恢复

实验卡：为一个端到端场景添加 mock Eval，验证审计链可追溯。

失败案例：中断 Run 后重新开始，验证 session 可恢复且没有残留成功状态。

证据模板：Eval 输出、取消审计、恢复步骤和复盘。
