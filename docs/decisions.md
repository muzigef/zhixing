# 已确认产品决策

> 状态：历史产品决策；当前实现与完成状态以 `TASKS.md`、`development-plan.md` 和 Evidence 为准。
> 生效范围：知行 MVP 与后续设计。除非用户明确修改，本文件中的决定优先于设计文档中的“可选”表述。

## 1. 首批主题

MVP 注册以下主题：

| topicId | 名称 | 状态 |
| --- | --- | --- |
| `agent-development` | Agent 开发学习 | 首批完整实现；计划来源为现有 Agent 学习计划 |
| `rag` | RAG 与 Grounding | 首批主题；实施时创建独立 `PLAN.md` |
| `tool-calling` | 工具调用与安全 | 首批主题；实施时创建独立 `PLAN.md` |
| `interview-project` | 面试与项目 | 首批主题；实施时创建独立 `PLAN.md` |

各主题必须拥有独立计划、Skill 根、进度、错题、资料、session 和审计目录。主题之间默认隔离。

## 2. 隐私与数据

- 默认启用**纯本地模式**：资料、Chunk、记忆、检索和学习记录不得发送到外部模型或云端 Embedding。
- 用户首次关闭纯本地模式并允许外发资料时，必须显示 Provider、发送内容类型和用途，并取得明确确认。
- 数据默认仅保存在本机 `zhixing/data/`、`zhixing/db/` 与 `learning-notes/`；不自动同步至云端或外部磁盘。
- 删除主题前必须展示受影响的原始资料、Chunk、记忆、session 与审计，并经二次确认后级联删除；全局 profile 保留。

## 3. 模型与认证

当前实现没有自动优先级选择：`tutor`、`reviewer`、`lab` 初始路由为 `mock`，用户可分别切换到 `deepseek-api` 或 `codex-cli`。路由保存在本地 `model-routing.local.json`；调用失败或真实 Provider 未获环境开关许可时受控降级到 `mock`。

- API Key 使用系统安全存储，配置和日志只保存 `secretRef`。
- 当前 API Key Provider 为 DeepSeek；当前官方 CLI Provider 为 Codex CLI。二者均不读取、保存或导出登录凭证。
- 知行不读取、保存、导出或传输浏览器 Cookie、账号 token、CLI 认证文件。
- 官方 CLI 不可用、登录失败或协议/条款不支持时，返回 `provider_unsupported`，并回退到 mock 或已配置的 API Provider。

## 4. 资料、RAG 与记忆

- 原始三天 MVP 决策支持文字 PDF 和 Markdown，并将 OCR 排入第二阶段；P2 现已实现本地 Tesseract OCR。
- 原始三天 MVP 决策使用 SQLite FTS5 和可定位引用，并将向量检索排入第二阶段；P2 现以本地 HashEmbedding 与 `chunk_embeddings` 兼容表完成融合检索，不使用 `sqlite-vec`。
- 本地资料单文件上限为 250 MB；该上限用于容纳已确认的大型 PDF，同时保留单主题 2 GB 配额。
- 所有资料问答必须给出页码或段落引用；无充分证据必须返回 `insufficient_evidence`。
- reviewer 通过的学习结论可自动写入主题学习记忆；模型自行总结不得写入长期记忆，必须得到用户确认。

## 5. 计划调整

知行可以根据完成率、review 分数、错题和用户可用时间生成计划调整建议，但不得自动覆盖启用中的计划。用户确认后创建新的计划版本并启用，保留原版本以供追溯。

## 6. 运行时与 SQLite

- 运行时固定为 Node `24.8.x`，`.nvmrc`、`package.json.engines` 与 `.npmrc` 共同约束版本。
- 本地存储使用 `better-sqlite3`，不再使用 Node experimental `node:sqlite`。
- 现有 `zhixing.sqlite` 保持标准 SQLite 格式；每次 schema migration 前必须备份，`schema_migrations` 记录已应用版本。

## 7. 三天 MVP 范围

三天必须优先交付：CLI、主题隔离、Mock/API Provider、PDF/Markdown 导入、SQLite/FTS5、带引用检索、基础长期记忆、证据审查与评估。

官方 CLI Provider adapter、资料/主题删除与基础备份属于 MVP 计划项；若因官方 CLI 协议差异或环境限制阻塞，允许降级为结构化 `provider_unsupported` 和人工可执行的备份/删除方案，必须在 Evidence 中记录，不能伪称已支持。
