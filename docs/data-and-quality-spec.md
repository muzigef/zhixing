<!-- generated-by: gsd-doc-writer -->
# 数据、记忆与质量契约

> 核对日期：2026-09-11，桌面包 0.11.0 当前代码。第 1–6 节以 CLI 数据为主，第 7 节说明桌面会话和共享学习数据。源码中的实际校验优先于设计目标。

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

`src/plan-schema.ts` 定义合法 topicId、唯一 DNN、正整数时长、非空枚举证据。TopicPlanLoader 使用 YAML 解析完整 frontmatter，禁止重复键和 alias，再通过 Zod；存在 days 的坏计划拒绝，不写入学习状态。仅无 days 的旧计划/缺文件保留兼容 fallback。开始学习前验证 Day 存在；前置主题由注册表与 Runtime 检查。

上方 YAML 是结构说明，内置可执行模板以 `topics/*/PLAN.md` 为准。计划文件上限 512,000 字节。

## 2. SQLite Schema

数据库位于 `<ZHIXING_ROOT>/zhixing/db/zhixing.sqlite`，启用 foreign keys、WAL；当前全局迁移记录为 1–6；各领域 Store 再创建自己负责的表，不能仅凭本节基础表清单推断完整数据库结构。CLI 默认根为代码仓库的父目录，见 [配置](CONFIGURATION.md)。主要业务数据表带 `topic_id`；`workflow_steps` 经 `run_id` 关联运行所属主题，`schema_migrations` 是全局元数据。显式全局记忆查询是跨主题读取入口。

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

导入入口将 signal 和 120 秒 deadline 贯通至文件读取、PDF 页提取、OCR 子进程与分块提交；取消新导入清理此次创建的副本，不保存阻断重试的失败哈希。损坏/加密等解析失败保留分类状态，可对同内容重试；成功文档去重，并在事务中再次检查并发导入。分块事务失败回滚索引，不删除用户原文件。

分块规则：

- PDF 先按页提取，再按段落切分；Markdown 按标题分段并保留 anchor。
- 每段连续无重叠切分，每块最多 1,000 个 UTF-16 单位，优先换行且不拆开代理对；所有块拼接可以重建该段全文，不截掉末尾。
- 每个 Chunk 继承 `topicId`、`documentId`、页码或 Markdown anchor 与原文哈希；新检索结果包含 chunkId，用于精确打开命中的片段。
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

当前支持软删除记忆、预览并确认删除资料；资料删除清理本地副本、Chunk、FTS、embedding 和 citation。数据库没有单独 pages 表。CLI 没有主题删除、自动每日备份、migration 前自动备份或学习数据整体导出；手动数据库备份不包含全部笔记和资料副本，恢复必须确认。桌面支持单会话 Markdown 导出及独立完整工作区/会话备份。

## 6. 质量、预算与隐私

离线 Eval 覆盖主题隔离、证据不足、导入失败分类、session 恢复等固定断言；不能将它描述为完整统计型 groundedness 基准。`groundedAnswer` 要求非空证据与可定位来源，发送最多 3 条，并检查回答至少有一个 citation 且所有引用都来自所给位置；另有 `EvidenceSupport` 对当前取得片段中的量化结论、过强措辞、长引语和引用歧义执行有界风险检查；仍不逐句证明语义蕴含。桌面检索返回来源经主题/文档/页码/anchor/chunkId 校验，但自由生成内容没有逐句事实核实。

Provider 有调用超时与大小限制；每个 OCR 子进程有 30 秒上限，普通导入另有 120 秒总 deadline。Provider 审计记录角色、耗时、状态、事件数、模型回合数与工具调用数，不记录 prompt、回答或工具参数。当前有纯只读工具最多两个并行、团队最多两个成员并发及持久累计 token 预留；没有精确计费 tokenizer 或货币费用预算。原生任务的 token 只能事后观测，未知用量不当作零消耗。

设置 `ZHIXING_ALLOW_LIVE_PROVIDER=0` 会禁止真实 Provider；本地 embedding 不会外发。已配置 Provider 时当前策略默认允许调用；不同命令的发送范围见 [配置](CONFIGURATION.md)。

## 7. 桌面对话与配置

桌面会话位于 `app.getPath("appData")/Zhixing`，聊天 JSON 与设置原子串行写入。学习数据默认在其 workspace 子目录，也可显式连接现有 CLI 工作区，直接使用同一 SQLite/课程/笔记；workspace.json 只保存路径。普通聊天、证据和设置未做应用级加密，API 凭据单独使用系统加密。

| 约束 | 当前值与行为 |
| --- | --- |
| IPC | 判别联合命令、UUID、字符串长度校验；没有任意文件或 Shell 命令 |
| 新输入 | 共享发送契约与桌面为 trim 后 1–20,000 字符；当前 CLI execute 另有8,000字符前置限制，属于尚待统一的入口差异 |
| 会话 | 最多 20,000 条消息；完整会话上限 12,000,000 字节，较早原文按 250 条分段，满额要求新建会话 |
| 模型历史 | 最多 24 条；目标与历史片段约 40,000 字符预算；当前请求、约束、摘要和授权学习资料另计，裁剪不删除显示历史 |
| 运行 | 每个 AgentService 实例仅一个前台生成，跨入口以会话/教学租约协调；ModelClient 最多10,000事件、64,000字符回答，单任务180秒，团队默认240秒，后端更短超时仍生效 |
| 状态 | `running`、`completed`、`interrupted`、`failed`、`waiting`、`blocked`；保留部分回答，合法完成事件、非空文本及计划/检查约束共同决定完成，模型声称完成无效 |
| 恢复 | 生成中约每 750 ms 尝试保存快照，重启将遗留 running 显示为 interrupted；不自动重放请求 |
| 凭据 | 内置 Provider 与自定义连接按身份保存独立 `.credential` 密文；已有 Key 不回传 renderer，状态仅提供配置元数据；官方订阅认证由官方运行时管理 |

会话另含 topicId、workspaceId、contextAllowed、持久目标/约束/摘要、最多 10 条待办及暂停状态。输入从队列移除和追加 user/running 消息同一原子保存；重启不自动外发。实现见 `desktop/core/contracts.ts`、`store.ts`、`service.ts`、`src/assistant-runtime.ts`。

## 8. 实施状态与后续范围

- **学习与资料**：课程契约、SQLite、PDF/Markdown、FTS5、可定位引用、显式记忆、主题隔离、删除、备份和复习均有实现；Tesseract OCR、低置信度状态、本地 HashEmbedding 和可选 loopback 语义检索继续保留。
- **共享执行**：两端复用 AgentService、连续摘要、分段历史、教学检查点、工具审批与恢复。三类 API 协议与官方订阅执行器使用不同后端契约，单 Agent / 同模型 / 异模型团队使用共同权限及预算。
- **客户端与平台**：桌面当前包版本0.11.0，CLI包0.1.0；支持 macOS/Windows 构建配置及对应本地实践沙箱，具体包是否安装/测试需查看该构建的证据，不能由配置推断。
- **后续范围**：逐句事实评估、加密备份、远程同步和冲突合并尚未完成；桌面 UI 已存在，独立浏览器 Web 产品未实现。

## 9. 实际产物与性能

EvidenceStore 在 `learning-notes/topics/<topicId>/evidence/<DNN>/` 保存带哈希的追加式文本和元数据；检查重新验证实际字节，旧布尔参数无效。用户提交的测试报告标为未复跑；macOS / Windows 受控 JS 测试运行器的结果与实现/脚本哈希绑定。Review 只评估计划要求的完整性，来源写入 Day 日志；状态仅在显式 Review 时更新。详细限制见 [升级指南](agent-upgrade.md)。

消息保存 contextMs/modelMs/compactionMs、firstTokenMs/durationMs 与回合/工具数。诊断返回脱敏性能数字与 Provider、型号、档位等条件标签，不导出正文；最近 20 段会话、最多 200 条消息，成功回答计算 P50/P95。Provider 可报告 Token 用量，未配置费用预算；真实质量结果见本轮 Evidence。

## 0.4 数据追加

会话 v2 增加 taskId、items（progress/final/question/approval/artifact）、usage、reasoning、retrievedCitations 和分支关系；原 v1 首次保存前备份，不接受未来版本。SQLite v6 兼容已有数据，执行任务/操作、独立课程作答与可选语义向量分别由对应 Store 建表。`assistant_operations` 最多 64 项/任务，计划最多 12 步；正文与工具结果保留在本地执行数据中，全量备份包含这些用户数据。

`semantic_embeddings`按模型 digest、chunk id、content hash 隔离。引用 marker 命中与检索候选分开，不等于事实核实。独立检查的成功、证据完整性和测试成功互不替代；复习为 1/3/7 天。备份 v1 清单逐文件保存 path/bytes/SHA-256，拒绝越界、符号链接、大小超限与未来数据库版本，恢复不覆盖原工作区。见 [0.4 指南](agent-0.4.md)。

## 0.6 持久化补充

历史 v7 格式保存三类访问绑定、限定写入授权、完整产品试验协议、逐轮构建/预算/授权证据。读取 v1–v6 不改写，首次保存前保留原文件；SQLite 标记 6 使旧应用拒绝新语义。存储中的原始历史和未知操作不因模型上下文裁剪而删除。

课程检查题库 `2026-09-08.2` 在每主题/学习日交替下发两种情境，题目、答案键、知识点、题库版本、题卷 ID 先持久保存；提交按该次原题评分，旧记录缺失新版本字段时仍用原题。帮助方式仍分别记录。效果验证保留原三份情境卷 v1，另用 `prompt_only` / `full_product` 区分试验协议，不能混为同一处理组。

新增表由所属 Store 创建：`tool_result_payloads`（有界工具原文）、`agent_task_usage`（累计用量）、项目快照/修改日志/回执表；会话索引为可重建缓存。导出、备份和实际数据契约见 [0.6 指南](agent-0.6.md)。

历史0.8引入分段结构；当前基础v8及后续会话清单保存尾部最多250条，旧原文位于同名 UUID 子目录，以 SHA-256 内容哈希校验；备份必须包含分段。teaching 检查点属于当前会话，旧格式缺省与新格式显式空值分开迁移。摘要的覆盖来源以 ID 和原文哈希复核，内容仍为未独立验证的模型概括。详见[统一记忆设计](agent-memory.md)。

## 当前格式与领域存储

会话按所含能力保存：v8 基础/图片，v9 团队，v10 早期审查，v11 团队协议3任务图，v12 原生任务预算，v13 成员资源策略。升级前保留 `.vN.bak`，未知版本和降级覆盖明确拒绝；聊天版本与 SQLite 全局标记6并不相同。执行检查点独立使用v1/v2/v3，当前统一上限4,000,000字节、128轮、10,000执行事件。

除基础资料表外，`AgentExecutionStore` 管理执行日志/累计用量/会话与教学租约，`TaskExecutionStore` 管理任务、修订及操作回执，`AssessmentStore` / `LearningObservations` / `LearningOutcomeStore` 管理作答与试验，`PracticeProjects` 管理文件快照/恢复日志/回执，`ToolResultStore` 管理分页原文。表定义由相应模块负责，详见[架构](architecture.md)和[统一记忆](agent-memory.md)。完整备份会包含这些本地用户数据，但不包含 API Key 或官方订阅凭据，恢复清除授权与运行租约。

字段校验与边界测试来源：[`agent-session-contracts.ts`](../src/agent-session-contracts.ts)、[`agent-session-store.ts`](../src/agent-session-store.ts)、[`database.ts`](../src/database.ts)、[分段与兼容测试](../tests/segmented-conversation.test.ts)、[团队资源策略测试](../tests/team-resource-policy.test.ts)。本次文档复核没有重新运行模型质量或教学试验。
