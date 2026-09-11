<!-- generated-by: gsd-doc-writer -->
# 功能与验收

核对日期：2026-09-11。本文描述桌面 `0.11.0` 的当前源码，历史增量及结果保留在[证据索引](evidence/README.md)。实际安装、真实账号与远端 CI 以[当前状态](current-status.md)为准，不根据源码版本推断已安装版本。

## 共享核心能力

CLI 与桌面共用 AgentService、教学与记忆策略、受控工具、完成检查及团队内核；界面、偏好、会话文件目录独立。显式连接同一学习工作区后，共用课程、资料、进度与证据。共享策略不表示两个界面的控件和输入限制完全一样。

| 范围 | 当前行为 | 主要验证入口 |
| --- | --- | --- |
| 主题与计划 | 内置/自建主题、画像、个性化计划与定制课程；启用课程需要确认 | `tests/cli-workflow.test.ts`、`tests/custom-course-store.test.ts` |
| 教学闭环 | 讲解、答疑、练习、实验与 Review；分类建议须有用户原文作答依据，展示答案不会算作实际作答 | `tests/teaching-dialogue.test.ts`、`tests/teaching-policy.test.ts` |
| 教学恢复 | 练习检查点归属会话；新会话/分支不继承旧练习，恢复旧会话不倒退主题完成进度 | `tests/teaching-session-isolation.test.ts` |
| 长对话与记忆 | 完整历史、分段保存、连续摘要与来源校验、显式/相关记忆、按预算构造本轮视图；撤回材料权限限制再次读取 | `tests/unified-agent-policy.test.ts`、`tests/memory-recall-quality.test.ts`、`tests/session-scaling.test.ts` |
| 资料与 RAG | PDF/Markdown、本地关键词与同义词检索、可选 loopback Ollama 语义检索；引用校验及证据不足提示 | `tests/integration.test.ts`、`tests/evidence-support.test.ts` |
| 工具与授权 | Pi/API 工具请求经 ToolHarness 校验 schema、范围、风险、期限与输出；材料/项目/MCP 分别授权，写入另需批准 | `tests/provider-tool-contract.test.ts`、`tests/agent-permissions.test.ts` |
| 执行与恢复 | 运行/步骤账本、持久任务、审批与问答、取消/排队/纠正、幂等恢复；未知副作用先核对，不安全重放被拒绝 | `tests/task-continuity.test.ts`、`tests/agent-recovery-boundaries.test.ts` |
| 完成检查 | 实际产物/哈希/测试来源驱动验收；模型的“已完成”和用户自报不等于服务验证 | `tests/evidence-application.test.ts`、`tests/task-execution.test.ts` |
| 三种协作模式 | 默认单 Agent；同模型或异模型团队最多两名成员，主模型分工、任务依赖、独立报告、分歧审查、一次定向复核与综合 | `tests/team-task-graph.test.ts`、`tests/team-coordinator.test.ts`、`tests/team-verification.test.ts` |
| 团队恢复与资源 | 冻结模型/权限/配置、只读成员、共享输入/输出/调用预算、成员自动档位、失败/中断/补做状态 | `tests/team-crash-recovery.test.ts`、`tests/team-task-recovery.test.ts`、`tests/team-resource-policy.test.ts` |
| 学习效果 | 前测、学习、后测、至少 72 小时后保留测；程序成绩与独立解释复核分开，记录辅助条件与构建来源 | `tests/learning-outcomes.test.ts`、`tests/outcome-blind-review.test.ts` |

## 模型接入状态

| 接入 | 当前实现与限制 |
| --- | --- |
| 官方 Codex 订阅 | 独立 AgentExecutor，不经 Pi；当前只启用已验收的 Codex 0.153.4，固定模型，支持单 Agent/团队；仅依据提供上下文回答，不执行工具、不支持图片 |
| Pi Codex | 公共 SDK worker，继承明确的 Pi 模型偏好与认证；支持应用工具，不开放 Pi 原生 Shell/文件执行器 |
| DeepSeek / Kimi API | 共用传输、教学/工具/记忆策略；独立凭据与原生推理参数，图片依模型能力判定 |
| 自定义 API | Chat Completions / Responses / Messages；十家模板及目录外兼容服务可配置，Key 独立保存；新协议需要适配器 |
| 官方 Claude Code | 仅上下文单 Agent 适配已实现，真实订阅未验收，未开放未固定模型团队 |
| Gemini CLI / 其他运行时 | 保留扩展目录和接口，未实现的运行时明确不可用，不回退另一厂商 |

订阅通道与 API Key 是不同账户/计费方式。路由切换不等于配置或连通；失败不会自动换厂商消费。通用扩展原则见[接入架构](provider-architecture.md)，具体设置见[配置](CONFIGURATION.md)。

## CLI 与桌面入口

| 入口 | 当前行为 |
| --- | --- |
| CLI / REPL | 学习管理命令、自然对话、主题路由、显式记忆、数据库备份、受限同步、团队命令、图片附件；当前 `execute()` 仍限制一条命令/输入 8,000 字符 |
| 桌面对话 | 流式 Markdown/GFM/KaTeX、复制、停止/继续/重试、主题、中文输入法、会话搜索/重命名/导出、草稿；共享请求上限 20,000 字符 |
| 桌面学习 | 课程/资料/进度/证据、工作区连接、学习效果记录、技能目录、提醒、独立实践项目和受控 MCP |
| 桌面配置 | 模型/原生程序/团队/预算设置、动态 API 连接、系统加密、完整备份恢复、主动检查版本 |
| 实践执行 | macOS 系统沙箱和 Windows AppContainer；JavaScript/Python 取决于实际运行时与隔离环境，缺失条件时明确不可用；不开放任意 Shell |

完整会话最多 20,000 条消息、12,000,000 字节，较早原文每 250 条分段；本轮初选目标/历史约 40,000 字符、最多 24 条，随后统一预算再裁剪。保存原文与模型当前看到的内容不是同一范围。普通会话 v8，团队按使用能力最高保存为 v13，SQLite 标记 6；升级保留原版本备份，读取不自动重写。聊天与草稿不是应用级加密。详见[数据契约](data-and-quality-spec.md)。

## 验收口径与当前结果

- Day 完成由 `检查 DNN` 检查实际产物，旧布尔参数不算证据；完整性分数不等于学习掌握度。
- `npm run verify` 覆盖静态检查、根/桌面类型、Vitest、integration、eval、mock smoke 和有限敏感扫描；需要两套依赖。七组 Electron UI 与实际包另行验证。
- 最近本地代码记录为 814 项测试、七组签名候选包 UI 和三家最小真实连接检查通过，见[2026-09-11 验收](evidence/provider-architecture-20260911.md)。本次文档编辑未重跑它们。
- `60570bc` 的远端审计和核心 verify 通过，团队 UI 超时导致工作流失败；不能写成 CI 全绿，详见[当前状态](current-status.md)。
- 最近团队预算回归中 20 个合成根任务均完整返回，但少量固定题和解释复核不证明普遍优于单 Agent，更不证明真实教学效果，见[预算评测](evidence/team-resource-budget-20260911.md)。
- API 状态/密文存在、真实连接、跨构建钥匙串连续性、界面、代码执行、真实学习效果分别验收，不能彼此代替。

## 明确限制与后续扩展

真实教学研究仍需参与者、独立评阅者和真实延迟；正式 macOS Developer ID/公证需发行账户配置。当前本机候选包与历史 Windows/Intel runner 证据不能证明所有 PC 兼容性。CLI 全部旧命令尚未统一注册表分派，入口 8,000 字符限制与桌面不同；精确统一跨厂商计费和官方 CLI 内部推理硬限尚不具备。DOCX 导入、主题删除、云同步、独立浏览器 Web 产品以及通用任意 Shell 编码工作台均不在当前实现范围。其他厂商保持按需扩展，不作为当前三家交付的阻塞项。
