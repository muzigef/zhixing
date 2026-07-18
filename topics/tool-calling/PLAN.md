---
topicId: tool-calling
title: 工具调用与安全
version: 1
prerequisites:
  - topicId: agent-development
    requiredDays: [D01]
requiredEvidence: [implementation, test-output, failure-case]
days:
  - id: D01
    title: 工具契约与参数校验
    estimatedMinutes: 120
    requiredEvidence: [implementation, test-output, failure-case]
    optional: false
  - id: D02
    title: 权限与路径边界
    estimatedMinutes: 120
    requiredEvidence: [implementation, test-output, failure-case]
    optional: false
  - id: D03
    title: 超时、取消与审计
    estimatedMinutes: 120
    requiredEvidence: [implementation, test-output, failure-case, reflection]
    optional: false
---

# 工具调用与安全

## D01：工具契约与参数校验

实验：为一个只读工具定义输入、输出和错误 shape。

失败案例：错误类型或缺少必填字段必须被 schema 拒绝。

## D02：权限与路径边界

实验：实现主题目录 allowlist。

失败案例：绝对路径、`..` 和符号链接越界必须被拒绝。

## D03：超时、取消与审计

实验：为长任务接入 AbortSignal 和结构化 audit。

失败案例：取消后不能产生成功结果或遗留可见副作用。
