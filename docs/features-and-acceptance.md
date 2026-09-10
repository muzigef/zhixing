# 功能与验收

2026-09-10 补充：0.11 已实现共享三模式团队、结构化报告、分歧审查与一次定向复核，验收以[三模式指南](agent-teams.md)和[最新证据索引](evidence/README.md)为准。以下 0.4–0.5 内容是历史阶段快照，其中“多 Agent 未实现”等历史限制不描述当前版本。

2026-09-07 源码补充：[学习效果验证](learning-outcomes.md)已接入桌面。验证入口为 `tests/learning-outcomes.test.ts`、`tests/desktop-outcomes.test.ts`、`tests/outcome-report.test.ts`、`tests/workspace-backup.test.ts` 及 `desktop/scripts/smoke-outcomes.mjs`。现有安装器尚未更新，本轮实际运行证据见[教学验证记录](evidence/learning-outcomes-20260907.md)。

> 核对日期：2026-09-06，桌面 0.4.0 升级。本文区分 CLI 学习 Agent 与桌面学习应用；历史阶段验收见 [证据索引](evidence/README.md)。

## CLI 当前功能

| 范围 | 当前行为 | 验证入口 |
| --- | --- | --- |
| 主题与计划 | 内置主题可选择；`创建主题 <topicId> <标题>` 创建受控本地主题。学习画像可生成个性化计划或定制课程；定制课程可经确认启用。 | `tests/cli-workflow.test.ts`、`tests/custom-course-store.test.ts` |
| 学习闭环 | `开始第 N 天` 受前置 Day gate 约束。真实 tutor 下依次进行讲解、答疑、练习，再由实验证据 Review 决定 Day 是否推进。mock 保持确定性学习卡。 | `tests/workflow.test.ts`、`tests/cli-workflow.test.ts` |
| 教学恢复 | 当前主题与受限教学检查点会持久化；重启后恢复 Day、阶段、受限转录与当前练习。 | `tests/current-topic-store.test.ts`、`tests/teaching-session-store.test.ts` |
| 教学动作 | 练习阶段先将自然语言约束为开始练习、作答、索要答案、提问、跳题或改计划；模型分类只是建议。索要答案有确定性优先级，只有可验证来自用户原文的作答才能触发批改和持久化。 | `tests/teaching-dialogue.test.ts` |
| 资料与 RAG | 仅导入 PDF/Markdown；本地 FTS5 与 HashEmbedding 混合检索。回答必须含可定位引用，否则返回 `insufficient_evidence`。 | `tests/integration.test.ts`、`tests/p2.test.ts` |
| Provider | `mock`、`deepseek-api`、`codex-cli`、`pi-codex` 可按角色路由。真实 Provider 支持文本流；Pi 显式继承 Codex 模型和推理偏好，认证由 Pi 处理。禁用外发开关会拒绝真实调用。 | `tests/provider-*.test.ts`、`tests/codex-client.test.ts`、`tests/deepseek-client.test.ts`、`tests/pi-client.test.ts`、`tests/pi-cli.test.ts` |
| Provider trace | 同一 Run 审计链记录 Provider、角色、耗时、状态、事件数、模型回合数与工具调用数；不记录 prompt、回答或工具参数。 | `tests/model-audit.test.ts`、`tests/model-invocation.test.ts`、`tests/run-context.test.ts` |
| 自然语言计划草案 | 计划草案经 Zod 校验，用户确认后只执行白名单知行命令；草案执行器不接受 Shell 或任意文件写入。普通知识问答可以直接生成回答，无需先生成计划。 | `tests/intent-parser.test.ts`、`tests/cli-workflow.test.ts` |
| 全局控制层 | 每轮输入先归为确定性命令、计划确认、教学输入或自然输入；随后才进入对应状态机和内容生成。 | `tests/interaction-protocol.test.ts` |
| 全局对话策略 | 命令、模型计划和教学分类共用授权/确认/用户原文证据策略；模型输出只能作为提议，不能单独触发状态写入或批改。 | `tests/interaction-protocol.test.ts`、`tests/teaching-dialogue.test.ts` |
| 运行账本 | 经过 RunManager 的前台业务操作有脱敏审计和 SQLite 运行/步骤账本；帮助、即时状态等控制命令不逐一记入账本。遗留运行启动时标记为中断，不自动重放写操作。 | `tests/run-manager.test.ts`、`tests/workflow-ledger.test.ts` |
| 工具执行契约 | Pi SDK / DeepSeek 的普通自由问答与显式学习助手可多轮调用本会话已授权的主题进度、资料目录和正文检索；完整维护 call ID 与工具历史。ToolHarness 校验 schema、主题、风险、截止时间与结果上限；两个入口均由共享 AgentService 组装上下文，Pi SDK 与 DeepSeek 支持工具续接；codex-cli 是文本兼容通道。 | `tests/agent-continuation.test.ts`、`tests/learning-agent-cli.test.ts`、`tests/model-invocation.test.ts`、`tests/tool-harness.test.ts` |
| 数据生命周期 | 可确认写入记忆、按 ID 忘记当前主题记忆、预览/确认删除资料、手动备份与确认恢复数据库。CLI 没有主题删除、自动每日备份、学习数据整体导出或迁移前自动备份。 | `tests/backup-service.test.ts`、`tests/cli-workflow.test.ts` |
| 连续对话 | 每主题保存最近 6 轮及独立初始目标；新建/恢复会话、继续/重试、生成时排队输入、即时状态/停止/调整、每主题回答风格及终端 Markdown。 | `tests/conversation-session.test.ts`、`tests/repl-controller.test.ts`、`tests/repl-input.test.ts`、`tests/terminal-markdown.test.ts` |

## 桌面当前功能

| 范围 | 当前行为 | 验证入口 |
| --- | --- | --- |
| 安装 | 自带 Electron 和 Pi 的 macOS arm64 `.app`、DMG、ZIP 本地预览；已有 Windows 构建/实际包 UI 流水线，实机未验收 | [桌面验收](evidence/desktop-app.md) |
| 对话与显示 | 流式 Markdown、GFM 表格、KaTeX、代码/回答复制、停止/继续/重试、系统/浅色/深色主题、中文输入法和快捷键 | `desktop/scripts/smoke.mjs` |
| 会话 | 历史、标题搜索、重命名、每会话草稿、Markdown 导出；独立系统应用目录原子保存，重启将未完成生成标记为中断 | `tests/desktop-storage.test.ts`、`tests/desktop-service.test.ts`、UI smoke |
| Provider | Pi Codex / DeepSeek API / 离线 demo 可选择；Codex 失败后由用户点击切 API 重试，保留同一会话；Flash/Pro 选择持久化 | `tests/desktop-providers.test.ts`、`tests/desktop-pi-runner.test.ts`、UI smoke |
| 凭据 | 主进程系统加密保存新增 DeepSeek Key，支持复用旧 macOS Keychain；不向页面回读已有 Key | `desktop/electron/secrets.ts`、`tests/desktop-providers.test.ts`；真实新 Key 保存仍待 OS 端到端验证 |
| 学习工作区 | 共享课程、进度、资料与引用；原生导入、显式连接 CLI 工作区；会话授权控制学习上下文 | `tests/learning-application.test.ts`、`desktop/scripts/smoke-learning.mjs` |
| 任务与上下文 | 排队/纠正/停止/撤回/重启后手动恢复；持久目标/约束、可选摘要、分模型耗时 | `tests/desktop-tasks.test.ts`、`tests/desktop-diagnostics.test.ts` |
| 产物验收 | 实际字节与哈希检查，区分用户报告和本地 JS 测试，来源写入日志 | `tests/evidence-application.test.ts`、学习 UI smoke |

每会话最多 20,000 条消息、完整原文合计 12 MB，较早原文按 250 条分段保存；目标和历史片段约 40,000 字符预算、最多 24 条历史；输入/约束/摘要/授权学习上下文另计。完整限制和持久化契约见 [数据契约](data-and-quality-spec.md)。桌面聊天与草稿并非应用级加密。

## Provider 数据边界

CLI 与桌面会话的外发和记忆规则统一，见 [记忆设计](agent-memory.md)。模型仅在会话授权后获得本地学习快照；凭据、审计原文和其他主题资料不进入模型输入。

## 验收规则

- Day 由 `检查 DNN` 对实际提交产物的完整性检查推进；旧布尔参数无效，分数不等同于能力评价。
- 自然交互的创建计划可在一次“直接运行”中保存画像、生成并启用定制课程；导入、删除、恢复和模型切换仍需明确确认。
- Provider 失败时，允许 fallback 的调用可使用 mock；教学和自然交互不会静默替换成 mock，直接显示错误。
- 本地发布门为 `npm run verify`（先安装根目录和 desktop 两套依赖）；桌面 UI 与实际安装包需另跑 `npm --prefix desktop run test:ui` 及打包应用验证。真实 Provider smoke 是单独的环境验收。

## 非当前实现

完整注册表分派、其他 Provider 的结构化工具续写、精确 token/费用预算、Claude 或本地 HTTP Provider、DOCX 导入、主题删除、云同步和独立浏览器 Web 产品仍未实现。桌面已经有 UI，但不具备通用编码 Agent 的任意文件编辑、Shell、多 Agent 或任务自动执行能力。Pi Codex 最近真实认证未通过；Windows/Intel Mac、签名/公证也未完成验收。

本轮本地回归、实包与 12 项真实回答结果见 [0.4 Evidence](evidence/agent-next.md)；旧记录是历史基线。

0.4 已增加结构化角色、双 Provider 应用工具、幂等恢复、推理档位/usage、审批/提问卡、编辑分支与比较、中文同义词与可选语义索引、独立课程检查、桌面技能及全量备份迁移。能力范围和外部验收见 [0.4 指南](agent-0.4.md)。

## 0.6 增量验收索引

C01–C12 的完整任务和验收条件见 [计划](agent-architecture-next-plan.md)，实际结果见 [本轮 Evidence](evidence/agent-architecture-next.md)。代表性回归包括 `provider-tool-contract`（双模型协议）、`task-continuity`（未知结果与修订）、`agent-permissions`（独立授权与撤回）、`teaching-policy`（实际知识点证据）、`evidence-support`（来源版本与主张）、`model-capabilities`（预算/模态）、`lazy-mcp`、`project-revisions`、`session-scaling`、`skill-catalog`、`product-validation` 和 `desktop-migration`。这些是 `tests/` 中同名 `.test.ts` 文件，完整 verify 还包含既有回归。
