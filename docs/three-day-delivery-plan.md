# 三天 AI 自动开发与验证计划

> 状态：历史三天排期，相关阶段验收已归档。以下 Node 20+、pnpm、Claude/本地模型、全局 profile 等是原始设想，不是当前配置或已交付承诺。当前基线为 Node 24.8.x + npm、四种 CLI Provider 与独立桌面应用，见 [开发计划](development-plan.md)、[任务台账](../TASKS.md) 和 [配置](CONFIGURATION.md)。
> 范围：仅 `zhixing/`；不修改已有学习计划、skills 或 `learning-notes/` 的既有内容。
> 决策基线：[已确认产品决策](decisions.md)
> AI 执行边界：[AI 自动开发、验证与测试协议](ai-execution-protocol.md)
> 实际代码任务：[实际开发 Backlog](implementation-backlog.md)
> 全阶段状态：[全量开发计划](development-plan.md)

## 当时的实施决策与设想（历史）

- 技术：Node 20+、TypeScript ESM、CLI；测试使用 Vitest，schema 使用 Zod。
- 首批主题：`agent-development`、`rag`、`tool-calling`、`interview-project`；每个主题有独立计划、Skill、进度、资料与记忆空间。
- 默认模型：`MockModelClient`；默认路由顺序为 mock、用户显式 API、官方 CLI、本地模型。真实 Provider 通过本地配置注入，API Key 经系统安全存储保存，密钥不入库。
- 支持来源：API Key、本机官方 Codex / Claude Code CLI 登录态和本地模型；不得读取浏览器 Cookie、订阅 token 或 CLI 认证文件。
- 初始入口：`pnpm start -- "开始第 1 天"` 和交互式 `pnpm repl`。
- 数据目录：`zhixing/data/` 与 `zhixing/db/`，加入 `.gitignore`；主题学习记录写入 `learning-notes/topics/<topicId>/`，全局偏好仅写入 `learning-notes/profile.md`；测试使用临时目录，不污染真实笔记。
- 历史策略（已替换）：曾采用默认纯本地与首次外发显式确认。当前策略见 `SECURITY.md`：已配置 Provider 默认可用，`ZHIXING_ALLOW_LIVE_PROVIDER=0` 可禁止外发。
- 资料与记忆：三天 MVP 支持文字 PDF/Markdown、SQLite 元数据、FTS5、带引用查询和结构化长期记忆；向量检索、Embedding 与 OCR 明确排入第二阶段。

> 本文保留原始排期和交付门槛，不代表当前功能清单。P6–P9 的交互与 Provider 改进、P10 桌面版均发生在此计划之后，具体结果见 [证据索引](evidence/README.md)。

## Day 1：可控学习闭环

**目标**：完成可运行的单 Agent Runtime、确定性学习状态机与笔记持久化，不依赖真实模型。

1. 初始化 package、TS/Vitest/ESLint 配置和 CI 风格脚本。
2. 定义 `topicId`、主题计划 schema、SQLite migration/schema、记忆 schema、事件、主题 session、run、tool、model、review verdict 的 TypeScript/Zod 契约，并以 `docs/data-and-quality-spec.md` 固化。
3. 实现 `TopicRegistry`（主题计划、skill 根、跨主题前置声明）、`LearningRuntime`、Router、TopicResolver、按主题运行的 DayGate、MockModelClient、取消和最大轮次保护。
4. 实现 TopicStore、Plan/Progress/Notebook 工具与 `topicId` realpath allowlist、原子写。
5. 将最小路由 skill 和 notebook/reviewer shared 规则接入 catalog，并建立 `skills/shared/` 与 `skills/<topicId>/` 目录约定。
6. 编写 E01、E02、E03、E04、E07、E08、E13、E15 的单元/集成测试。

**Day 1 验收**：mock 下能在两个主题分别启动 Day 1、拒绝主题内跳 Day、根据 reviewer 结果更新正确主题记录；路径逃逸、跨主题写入与取消均有负向测试。

## Day 2：教学工作流、审计与恢复

**目标**：补齐 tutor/lab/reviewer/source-guide 工作流，做到可恢复、可解释、可审计。

1. 迁入/注册七个 Markdown skills，支持 shared + 当前主题 skill 的摘要列表、按需读取、坏 skill 隔离。
2. 实现 `ProviderRegistry`、`ModelRouter`、Mock/API/本地模型 adapter、`SecretStore` 和按角色路由；定义官方 Codex / Claude Code CLI adapter 的白名单健康检查边界。
3. 实现只加载全局 profile、当前主题记录和当前主题近期历史的 ContextBuilder，以及裁剪、重复工具调用检测和大结果摘要。
4. 实现证据解析、确定性评分骨架和 reviewer 的 `advance/reinforce/repair` 主题内写入门。
5. 实现按主题目录保存的 JSON session snapshot 和脱敏 JSONL audit；保证 Key、token 和 Cookie 永不落盘。
6. 实现源码导读前置检查、`继续` 最小下一步、复习卡片生成与 `全部进度` 汇总。
7. 编写 E05、E06、E09、E10、E11、E12、E14、E16–E20 测试；运行 Day 1 全量回归。

**Day 2 验收**：进程重启后只能恢复指定主题中进行的 Day；审计脱敏且带 `topicId`；模拟 API Key 不出现在任何配置和日志；官方 CLI 异常可降级；模型故障后非模型命令仍可用；所有 E01–E20 在 mock 下通过。

## Day 3：CLI 交付、评估与人工可复现验证

**目标**：完成 CLI、人机可用性、可重复评估和交付证据。

1. 实现 REPL/headless CLI、流式事件渲染、`--verbose`、`取消` 和清晰错误信息。
2. 实现主题资料库：PDF/Markdown 导入、哈希去重、`pdfjs-dist` 页面文本提取、SQLite 元数据/Chunk、FTS5、引用定位和 `ocr_required` 分支。
3. 实现 `MemoryStore`：经确认/证据驱动的长期记忆写入、查询和删除；默认主题隔离；实现 SQLite 基础备份。
4. 实现导入配额、取消/事务回滚、资料删除影响预览、纯本地模式和首次外发资料确认。
5. 建立 31 条固定评估集与 `pnpm eval` 报告；将结果保存到 `docs/evidence/` 的脱敏摘要。
6. 运行 lint、typecheck、单元、集成、eval、mock/资料 smoke；逐项修复失败。
7. 若用户提供合法本地模型配置，执行一次 live smoke；否则明确记录为未执行而非失败。
8. 完成 README、架构、工具权限矩阵、已知限制、测试命令和故障排查。
9. AI 自审：路径/密钥/资料注入扫描、状态机转移、取消、失败恢复、测试覆盖映射。

**Day 3 验收**：所有发布门槛（除可选 live smoke）通过；新机器按 README 可在 mock 模式复现 E01、E04、E21 和 E24；提交证据包含命令、资料引用输出、失败场景及限制。

## AI 执行协议

详细授权、不可违反约束、固定实施顺序、暂停条件和完成定义以 [AI 自动开发、验证与测试协议](ai-execution-protocol.md) 为准。每一项由 AI 按以下闭环推进，避免“写完即宣布完成”：

```text
读取当前契约与测试 -> 先写失败测试 -> 最小实现 -> 定向测试
-> typecheck/lint -> 检查 diff 与敏感信息 -> 更新文档和证据 -> 进入下一项
```

- 任何真实文件写入前，AI 只能使用 `NotebookStore`；不允许绕过权限层。
- 测试失败时先修当前最小边界，不扩展功能或引入多 Agent 规避问题。
- 每日结束输出：已完成、命令与结果、未验证项、阻塞项、次日第一步。
- 历史 Day 3 交付门已满足；当前全量质量门仍为 `npm run verify`。

## 风险与降级

| 风险 | 处理 |
| --- | --- |
| 没有 API Key 或 provider 不稳定 | 全部必需验收使用 mock；live smoke 可选 |
| Markdown 格式历史不一致 | parser 返回诊断并保留旧 catalog，禁止批量改写原笔记 |
| 模型跳过学习流程 | Router/DayGate/Reviewer 在代码层约束状态转移 |
| 写错本地文件 | realpath allowlist、限定工具、原子写、临时目录测试 |
| 三天范围膨胀 | 不做 Web、MCP、浏览器、Bash、向量检索、OCR、多 Agent；仅交付 FTS5 RAG |
| 主题数据串扰 | `topicId` 必填、按主题存储根、上下文白名单与 E13–E16 回归测试 |
| API Key 泄露 | SecretStore、日志脱敏、配置/审计扫描与 E17 回归测试 |
| 订阅凭证或条款边界不明确 | 仅复用官方 CLI 登录；不读取凭证；不支持时返回 `provider_unsupported` 并降级 |
| PDF 解析失败或为扫描件 | 保留原文件与状态；返回 `ocr_required`，不产生虚构文本 |
| RAG 幻觉或资料提示注入 | 强制引用、证据不足拒答；资料作为不可信数据，不能改变系统/工具规则 |
