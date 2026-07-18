# 数据、记忆与质量契约

> 状态：已实现契约并完成文档同步。本文定义主题计划、SQLite、资料导入、分块、记忆与质量控制边界；历史阶段描述已按 P2 实现更新。

## 1. Topic Plan Schema

每个主题必须由 `TopicRegistry` 注册，并有独立 `PLAN.md`。frontmatter 为机器读取的契约，正文为人类可读说明。

```yaml
---
topicId: rag
title: RAG 与 Grounding
version: 1
prerequisites:
  - topicId: agent-development
    requiredDays: [D01, D02]
days:
  - id: D01
    title: 本地资料检索基础
    estimatedMinutes: 120
    requiredEvidence:
      - implementation
      - test-output
      - failure-case
    optional: false
---
```

约束：`topicId` 必须是 kebab-case；Day ID 在主题内唯一；`estimatedMinutes` 为正整数；前置主题和 Day 必须已注册；`requiredEvidence` 至少包含一个可验证产物。解析失败时主题不可激活，已有主题状态不受影响。

## 2. SQLite Schema

数据库位于 `zhixing/db/zhixing.sqlite`，启用 foreign keys、WAL 和 schema migration。所有业务表必须带 `topic_id`；所有主题内读取均使用 `WHERE topic_id = ?`。

| 表 | 核心字段 | 用途与索引 |
| --- | --- | --- |
| `schema_migrations` | `version`, `applied_at` | 迁移幂等与回滚前检查 |
| `documents` | `id`, `topic_id`, `sha256`, `name`, `mime_type`, `status`, `created_at` | `UNIQUE(topic_id, sha256)`，避免同主题重复导入 |
| `chunks` | `id`, `topic_id`, `document_id`, `page_number`, `anchor`, `text`, `content_hash` | `(topic_id, document_id)` 索引；定位回 PDF 页或 Markdown anchor |
| `chunks_fts` | `chunk_id`, `topic_id`, `text` | FTS5 关键词召回，不作为元数据真相源 |
| `chunk_embeddings` | `chunk_id`, `topic_id`, `dimensions`, `vector_json` | 本地 HashEmbedding 的 SQLite 兼容存储 |
| `memories` | `id`, `topic_id`, `memory_type`, `content`, `source_kind`, `source_ref`, `confidence`, `confirmed_at`, `deleted_at` | `(topic_id, memory_type, deleted_at)` 索引；软删除可追溯 |
| `citations` | `id`, `topic_id`, `document_id`, `chunk_id`, `page_number`, `anchor` | 保证回答引用可定位 |

Session snapshot 和审计日志仍以文件保存；数据库只保存需要检索、关联和事务约束的数据。

## 3. 资料导入与分块

MVP 支持 PDF 和 Markdown。默认限制：单文件 250 MB（已确认的本地 PDF 配额）、PDF 500 页、单主题 2 GB、单次导入 10 个文件；所有限制做成可配置上限。拒绝损坏、加密、未知 MIME、超限和符号链接文件，并返回稳定错误码。

导入必须可取消。解析/写入失败时事务回滚数据库记录，保留原文件并标记失败原因；不得留下部分可检索 Chunk。相同文件在同一主题返回已有 `documentId`，跨主题则可独立导入。

分块规则：

- PDF 先按页提取，再按段落切分；Markdown 按标题层级和段落切分。
- 目标长度为 500–800 中文字符，最大 1,000 字符；相邻 Chunk 可保留最多 100 字符重叠。
- 每个 Chunk 必须继承 `topicId`、`documentId`、页码范围或 Markdown anchor、原文哈希和标题路径。
- 不可解析文本返回 `ocr_required` 或 `parse_failed`，不生成空 Chunk。

## 4. 记忆 Schema 与生命周期

允许的 `memory_type`：`profile`、`learning_fact`、`mistake`、`knowledge_card`、`episodic`。每条记忆必须有来源、时间、置信度和删除能力。

| 写入来源 | 是否允许写长期记忆 | 规则 |
| --- | --- | --- |
| 用户显式“记住” | 是 | 显示待写入内容和主题，得到确认后写入 |
| reviewer=`advance` | 是 | 仅写已验证学习结论，`source_kind=review` |
| 资料检索 | 是 | 必须至少一个 citation，`source_kind=document` |
| 模型自行总结 | 否 | 只能停留在工作记忆或等待确认 |

当前记忆没有 `expires_at` 或记忆向量索引；用户的“忘记”操作仅软删除当前主题记忆。原始学习记录和资料除非用户选择资料删除，否则不级联删除。

## 5. 跨主题、删除与备份

默认检索只作用于当前 `topicId`。用户明确选择“全部主题”后，查询才可跨主题，并且每条结果必须显示来源主题。`profile` 只保存目标、时间预算、偏好和经确认的跨主题薄弱项，禁止保存完整对话、资料 Chunk 或 API 凭证。

删除分三级：删除记忆、删除资料版本、删除整个主题。每种操作均先展示影响范围；资料删除级联删除对应页、Chunk、FTS 和 citation，主题删除还清理其 session/audit，但不删除全局 profile。SQLite 每日备份并在 schema migration 前创建备份；导出格式为 Markdown + JSON，保证可迁移。

## 6. 质量、预算与隐私

RAG MVP 的离线 Eval 至少测量：关键词召回命中、引用可定位率、groundedness、证据不足拒答率、跨主题隔离率。回答中每个事实性结论必须至少有一个 citation；引用不存在、主题不一致或无法定位即判失败。

每次导入、检索、模型调用都受超时、文件/Chunk 数、并发、token 和费用预算约束。Provider 能力表必须声明是否支持流式、工具调用、结构化输出、Embedding、上下文窗口及费用统计。

提供“纯本地模式”：禁止外部模型和云端 Embedding，资料文本不得离开本机。非纯本地模式下，在首次把资料 Chunk 发送到外部 Embedding 或模型前，必须明确告知用户 Provider、发送内容类型和用途，并取得确认。

## 7. 实施状态与后续范围

- **P0/P1**：Topic Plan Schema、SQLite migration、PDF/Markdown 导入、FTS5、引用、结构化记忆、主题隔离、删除、备份、复习与 session 已实现。
- **P2**：Tesseract OCR、低置信度状态、本地 `HashEmbeddingModel`、`chunk_embeddings` SQLite 兼容表、混合检索/重排序，以及 loopback Web/SSE 契约已实现。当前不使用 `sqlite-vec` 二进制扩展。
- **后续范围**：大资料库迁移评估 LanceDB、加密备份、远程多端同步、冲突合并和 Web UI 均未登记为当前任务。
