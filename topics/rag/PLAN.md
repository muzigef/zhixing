---
topicId: rag
title: RAG 与 Grounding
version: 1
prerequisites:
  - topicId: agent-development
    requiredDays: [D01, D02]
requiredEvidence: [implementation, test-output, failure-case]
days:
  - id: D01
    title: 本地资料导入与引用
    estimatedMinutes: 120
    requiredEvidence: [implementation, test-output, failure-case]
    optional: false
  - id: D02
    title: FTS5 检索与证据不足
    estimatedMinutes: 120
    requiredEvidence: [implementation, test-output, failure-case]
    optional: false
  - id: D03
    title: Grounded Answer 评估
    estimatedMinutes: 120
    requiredEvidence: [implementation, test-output, failure-case, reflection]
    optional: false
---

# RAG 与 Grounding

## D01：本地资料导入与引用

实验：导入一份 Markdown 或文字 PDF，验证文档 ID、Chunk 数和 citation。

失败案例：扫描 PDF 必须返回 `ocr_required`，不能生成虚构文本。

## D02：FTS5 检索与证据不足

实验：为一个术语执行主题内检索，并验证跨主题无结果。

失败案例：无命中问题返回 `insufficient_evidence`。

## D03：Grounded Answer 评估

实验：对三个问题检查答案中的每个事实是否能定位到页码或 anchor。

失败案例：移除 citation 后，评估必须判定不通过。
