# 数据、记忆与质量契约

> 核对日期：2026-09-05，代码基线 `6b87f51`。第 1–6 节以 CLI 数据为主，第 7 节说明独立桌面数据。源码中的实际校验优先于设计目标。

## 1. Topic Plan Schema

内置主题由 `TopicRegistry` 注册；用户也可通过 `创建主题 <topicId> <标题>` 创建受控本地主题并初始化 `PLAN.md`。frontmatter 为机器读取的契约，正文为人类可读说明。

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
    requiredEvidence: [implementation, test-output, failure-case]
    optional: false
---
```

`src/plan-schema.ts` 定义的 Zod 契约要求合法 `topicId`、唯一的 `DNN` Day、正整数时长，以及至少一个枚举证据项。该 schema 不查询前置主题是否已注册。当前 `TopicPlanLoader` 以受限 frontmatter 格式解析 Day，`requiredEvidence` 使用行内数组，例如 `[implementation, test-output, failure-case, reflection]`；缺失或旧格式可回退默认证据门，并不是所有 PLAN 读取都经过完整 Zod 校验。主题前置由注册表与 Runtime 的 Day gate 另外检查。

上方 YAML 是结构说明，仓库内可执行模板以 `topics/*/PLAN.md` 为准。不要据 schema 存在就宣称任意 YAML 解析或所有坏计划一律拒绝。

## 2. SQLite Schema

数据库位于 `<ZHIXING_ROOT>/zhixing/db/zhixing.sqlite`，启用 foreign keys、WAL；当前迁移记录为 1、2、3。CLI 默认根为代码仓库的父目录，见 [配置](CONFIGURATION.md)。主要业务数据表带 `topic_id`；`workflow_steps` 经 `run_id` 关联运行所属主题，`schema_migrations` 是全局元数据。显式全局记忆查询是跨主题读取入口。

| 表 | 核心字段 | 用途与索引 |
| --- | --- | --- |
| `schema_migrations` | `version`, `applied_at` | 迁移幂等与回滚前检查 |
| `documents` | `id`, `topic_id`, `sha256`, `name`, `mime_type`, `status`, `created_at` | `UNIQUE(topic_id, sha256)`，避免同主题重复导入 |
| `chunks` | `id`, `topic_id`, `document_id`, `page_number`, `anchor`, `text`, `content_hash` | `(topic_id, document_id)` 索引；定位回 PDF 页或 Markdown anchor |
| `chunks_fts` | `chunk_id`, `topic_id`, `text` | FTS5 关键词召回，不作为元数据真相源 |
| `chunk_embeddings` | `chunk_id`, `topic_id`, `dimensions`, `vector_json` | 本地 HashEmbedding 的 SQLite 兼容存储 |
| `memories` | `id`, `topic_id`, `memory_type`, `content`, `source_kind`, `source_ref`, `confidence`, `confirmed_at`, `deleted_at` | `(topic_id, memory_type, deleted_at)` 索引；软删除可追溯 |
| `citations` | `id`, `topic_id`, `document_id`, `chunk_id`, `page_number`, `anchor` | 保证回答引用可定位 |
| `workflow_runs` | `run_id`, `topic_id`, `action_id`, `idempotency_key`, `state_version`, `status`, `started_at`, `finished_at`, `error_code` | 前台操作账本；哈希包括命令与 run ID，重复命令可创建新运行，不提供跨运行自动去重 |
| `workflow_steps` | `run_id`, `step_id`, `status`, `at`, `detail` | 运行内步骤状态；进程中断不会自动重放写操作 |

Session snapshot 和审计日志仍以文件保存；数据库只保存需要检索、关联和事务约束的数据。

## 3. 资料导入与分块

当前导入命令一次处理一个 PDF 或 Markdown 文件。限制为单文件 250 MiB、PDF 500 页、单主题 2 GiB；这些限制是代码常量，不是用户配置项。扩展名白名单为 `.md`、`.markdown`、`.pdf`，不是独立 MIME 内容探测器。CLI 导入入口通过 `realpath` 拒绝解析后越出 inbox 的路径；仍在 inbox 内的符号链接可以被接受，主题取自解析后的路径。解析器再分类损坏、加密和超限 PDF。

底层 `DocumentLibrary.importFile` 可接收取消信号，在读文件和分块写入等阶段检查；CLI 的 `importStagedDocument` 尚未接收并转发该信号，PDF 页面提取和 OCR 也未全程接入，因此不保证 CLI 导入能即时取消。已分类的解析失败/取消保留失败元数据，分块事务失败会回滚索引，不删除 inbox 原文件；不能承诺每种底层写入异常都已有统一失败记录。相同哈希在同一主题返回已有 `documentId`（包括已记录的失败项），跨主题可独立导入。

分块规则：

- PDF 先按页提取，再按段落切分；Markdown 按标题分段并保留 anchor。
- 当前按空行分段，以累计约 800 字符为切分触发点，并保留前段末尾 100 字符；没有固定 500 字符下限。末尾分块使用 `slice(0, 1000)`，超长单段可能截断，先前分块也可能超过 1,000 字符；严格保真长段切分是已知缺口。
- 每个 Chunk 继承 `topicId`、`documentId`、页码或 Markdown anchor 与原文哈希；当前不持久化 Markdown 标题路径。
- 不可解析文本返回 `ocr_required` 或 `parse_failed`，不生成空 Chunk。

## 4. 记忆 Schema 与生命周期

允许的 `memory_type`：`profile`、`learning_fact`、`mistake`、`knowledge_card`、`episodic`。当前 schema 保存来源、置信度、可空的确认时间及软删除时间，没有独立 `created_at` 或 `expires_at`；枚举支持不代表对应自动记忆流程已实现。

| 写入来源 | 是否允许写长期记忆 | 规则 |
| --- | --- | --- |
| 用户显式“记住” | 是 | 命令带 `--确认` 后向当前主题写入；当前没有独立的内容/主题预览确认步骤 |
| reviewer=`advance` | 否（当前未接入） | 可作为后续自动写入的候选来源 |
| 资料检索 | 否（当前未接入） | 可作为后续带 citation 的候选来源 |
| 模型自行总结 | 否 | 只能停留在工作记忆或等待确认 |

当前记忆没有 `expires_at` 或记忆向量索引；用户的“忘记”操作仅软删除当前主题记忆。原始学习记录和资料除非用户选择资料删除，否则不级联删除。

## 5. 跨主题、删除与备份

资料检索与普通记忆查询作用于选定 `topicId`。`全局查询记忆 <问题>` 显式跨主题并显示来源；资料没有对应全局检索入口。学习画像由每主题 `LearningProfileStore` 保存，与数据库中的 `profile` 记忆枚举不同；当前没有全局 `learning-notes/profile.md` 或自动汇总跨主题薄弱项。

当前支持软删除记忆、预览并确认删除资料；资料删除清理本地副本、Chunk、FTS、embedding 和 citation。数据库没有单独 pages 表。CLI 没有主题删除、自动每日备份、migration 前自动备份或学习数据整体导出；手动数据库备份不包含全部笔记和资料副本，恢复必须确认。桌面支持单会话 Markdown 导出。

## 6. 质量、预算与隐私

当前离线 Eval 覆盖主题隔离、证据不足、导入失败分类、session 恢复等固定断言；不能将它描述为完整统计型 groundedness 基准。`groundedAnswer` 要求非空证据与可定位来源，发送最多 3 条，并检查回答至少有一个 citation 且所有引用都来自所给位置；它不逐句验证事实是否由证据支持。桌面自由对话没有接入这项资料校验。

Provider 有调用超时与大小限制；每个 OCR 子进程有 30 秒上限，但普通导入尚无统一总时限。Provider 审计记录角色、耗时、状态、事件数、模型回合数与工具调用数，不记录 prompt、回答或工具参数。当前没有通用并发、精确 token 或费用预算；这些属于后续能力。

设置 `ZHIXING_ALLOW_LIVE_PROVIDER=0` 会禁止真实 Provider；本地 embedding 不会外发。已配置 Provider 时当前策略默认允许调用；不同命令的发送范围见 [配置](CONFIGURATION.md)。

## 7. 桌面对话与配置

桌面数据位于 `app.getPath("appData")/Zhixing`，不使用 CLI SQLite。主进程 `DesktopStore` 保存 `preferences.json` 与 `conversations/<UUID>.json`，采用临时文件加 rename；普通会话和设置是明文，新增 API 凭据单独系统加密。输入草稿和当前会话 ID 保存在 renderer localStorage。

| 约束 | 当前值与行为 |
| --- | --- |
| IPC | 判别联合命令、UUID、字符串长度校验；没有任意文件或 Shell 命令 |
| 新输入 | trim 后 1–20,000 字符 |
| 会话 | 最多 1,000 条消息；JSON 文件读写上限 12,000,000 字节，满额要求新建会话 |
| 模型历史 | 最近最多 24 条、48,000 字符；当前请求及系统提示另计，裁剪不删除显示历史 |
| 运行 | 应用全局仅一个生成；最多 20,000 个事件、64,000 字符回答、180 秒总限时，Provider 更短超时仍生效 |
| 状态 | `running`、`completed`、`interrupted`、`failed`；保留部分回答，收到合法完成事件且有文本才视为完成 |
| 恢复 | 生成中约每 750 ms 尝试保存快照，重启将遗留 running 显示为 interrupted；不自动重放请求 |
| 凭据 | `deepseek.credential` 只存系统加密结果；已有 Key 不回传 renderer，状态仅提供配置元数据 |

具体实现见 `desktop/core/contracts.ts`、`store.ts`、`service.ts`、`secrets.ts` 与 `desktop/electron/main.ts`。桌面没有学习主题 ID、长期记忆或 CLI 工作流账本。

## 8. 实施状态与后续范围

- **P0/P1**：Topic Plan Schema、SQLite migration、PDF/Markdown 导入、FTS5、引用、结构化记忆、主题隔离、删除、备份、复习与 session 已实现。
- **P2**：Tesseract OCR、低置信度状态、本地 `HashEmbeddingModel`、`chunk_embeddings` SQLite 兼容表、混合检索/重排序，以及 loopback Web/SSE 契约已实现。当前不使用 `sqlite-vec` 二进制扩展。
- **P6–P9**：多轮工具调用限制、持久对话与教学恢复、Pi 文本适配已落地；**P10**：独立桌面聊天及双 Provider 切换已交付 macOS arm64 预览。
- **后续范围**：严格保真分块、完整计划 schema 接入、逐句事实评估、加密备份、远程同步和冲突合并尚未完成；桌面 UI 已存在，独立浏览器 Web 产品未实现。
