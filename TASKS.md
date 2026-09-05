# 知行前台开发任务清单

> 核对日期：2026-09-05，最新维护基于 `9c4c901` 修复 CI 依赖安全告警。执行以当前用户授权任务为准；完成后更新本文件、Evidence，并运行适用的验证。
> 状态：`[x]` 已验证，`[~]` 基础实现/待收口，`[ ]` 未开始。
> 历史 P0 分解见 [P0 自动执行 Tasklist](docs/p0-tasklist.md)。

## P0：MVP 验收收口

- [x] E01–E06：Day 输出契约、Review、继续、源码导读，含隔离根目录 CLI 端到端覆盖。
- [x] E07/E10/E12：Run 取消、完整工具事件审计、LoopGuard 接入 Runtime，含 RunManager/CLI 审计与 Runtime 边界覆盖。
- [x] E08：路径与符号链接越界拒绝。
- [x] E09：Skill 坏文件 fail-closed 与旧 catalog 保留。
- [x] E11：Provider unavailable 降级到 mock 的 Runtime 接入，含 CLI fallback 覆盖。
- [x] E13–E16：主题隔离、跨主题前置、全部进度与 session 恢复，含 CLI 覆盖。
- [x] E17–E20：Keychain、DeepSeek/Codex、角色路由、模型列表/状态与 fallback，含 CLI 覆盖。
- [x] E21–E29：资料导入、引用、失败分类、恢复状态、文件/页数/主题配额与 citation 完整性评估。
- [x] E30：资料/记忆删除影响预览、备份预览与受 `--确认` 保护的恢复 CLI。
- [x] E31：历史纯本地与资料外发确认门覆盖；当前 Provider 默认策略见 `SECURITY.md`。

## P1：学习产品体验

> 可执行分解见 [P1 自动执行 Tasklist](docs/p1-tasklist.md)，按其顺序自动推进。

- [x] 完整 Topic Plan 解析：逐 Day `requiredEvidence`、时长、可选项。
- [x] 课程内容、实验卡、失败案例与证据模板完善。
- [x] Skill 按需加载到 tutor/reviewer/lab 工作流。
- [x] 自然语言 grounded answer 的 CLI 端到端流程。
- [x] 计划调整、复习计划、评分驱动复习优先级与基础间隔重复。
- [x] Session snapshot、恢复与历史裁剪。

## P2：第二阶段

- [x] OCR 与低置信度页。
- [x] SQLite 向量兼容表、混合检索与重排序（不使用 sqlite-vec 扩展）。
- [x] macOS OS sandbox 受限执行边界（Docker 非依赖）。
- [x] loopback Web/SSE、主题隔离同步契约。

## P3：个性化学习

- [x] P3-01：每主题学习画像、待确认个性化计划、资料概览、Skill 草案与显式启用。
- [x] P3-02：模型无关的本地学习建议；可选外发建议只发送画像和资料文件名。
- [x] P3-03：模型审计记录实际执行的 Provider 及受控 fallback。

## P4：通用主题与学习编排

- [x] P4-01：受控创建主题、持久化本地注册表与主题初始化。
- [x] P4-02：从学习画像生成、预览并显式启用定制课程。
- [x] P4-03：主题概览、唯一下一步和本地提醒计划。

## P5：受控模糊命令

- [x] P5-01：本地别名、容错与歧义写操作候选。
- [x] P5-02：可选模型意图草案、Zod 校验、确认前不执行写操作。
- [x] P5-03：默认自然多轮交互、当前主题恢复、一次授权生成并启用定制课程，以及模型驱动的当日讲解与追问。
- [x] P5-04：官方 Codex CLI `exec --ephemeral --json` 文本流、自然草案白名单执行、统一模型进度/失败反馈与回归覆盖。未使用 app-server 持久会话。

## P6：Agent 核心运行时审查与修复

- [x] 多轮工具续写、真实 DeepSeek/CLI 接入、取消/资源预算/流协议、主题路径与教学检查点加固。验收证据见 [运行时审查](docs/evidence/agent-runtime-audit.md)。

## P7：交互、内容与终端输出

- [x] 自然问答与计划分流、直接教学意图、主题风格、Markdown 流式输出、输入队列、中断恢复和引用质量。验收证据见 [交互与输出修复](docs/evidence/interaction-quality-audit.md)。

## P8：流畅连续对话

- [x] 普通聊天持久化、主题内新建/恢复会话、继续与重试。
- [x] 生成时持续接收输入、即时状态、自然停止/调整、排队撤回、多行输入。
- [x] 短段落定时刷新、输入草稿与回答显示分离、隐藏输入独占与正常退出。
- [x] 自由问答自动接入已有只读工具，草案自然确认、教学恢复及长中文会话边界。
- [x] 52 个测试文件、249 个测试和完整质量门通过；证据见 [连续对话修复](docs/evidence/fluent-conversation-audit.md)。

## P9：使用 Pi 配置的 Codex 模型

- [x] Pi 模型配置继承、安全启动器与 JSON 文本流适配、取消/超时、路由与错误脱敏；完整质量门 54 个测试文件、267 个测试通过。
- [x] 本机 tutor 路由已切换到 `pi-codex`，读取 Pi 的 `gpt-5.6-terra / medium`。
- [~] 真实连接：Pi 能列出已配置 Codex 模型，但调用未取得可用认证；等待在 Pi 完成登录后重试。当前不能报告模型可用或响应速度。
- 验收记录见 [Pi Codex 接入](docs/evidence/pi-codex-integration.md)。

## P10：可安装桌面应用

- [x] Electron + React 桌面外壳、会话侧栏、流式聊天、输入草稿、停止/继续/重试、快捷键、Markdown 与数学、浅色/深色主题。
- [x] 会话历史、搜索、重命名、Markdown 导出，独立系统应用数据目录和原子保存。
- [x] 内附 Pi 运行时；Pi Codex / DeepSeek API 切换、Codex 失败后一键切 API 重试，复用现有钥匙串配置及应用内加密配置入口。
- [x] 58 个测试文件/281 个测试及完整质量门；真实 Electron 和打包 `.app` 的端到端 UI 测试通过。
- [x] macOS Apple Silicon `.app` / DMG / ZIP 已构建，DMG 完整性检查通过。
- [x] DeepSeek 真实短请求返回 `4`：首字 2.317 秒，总耗时 2.383 秒。
- [ ] Windows 实机验收、Intel Mac 构建及 Apple Developer ID 签名/公证。
- [x] 课程、资料与进度桌面入口已在 P11 共享应用服务中实现并验收。
- [x] CI 安装根目录与桌面依赖，增加 Electron UI；另有 macOS/Windows 构建与实际包 UI 流水线。远端运行结果仍待验收。
- 验收记录见 [桌面应用](docs/evidence/desktop-app.md)，使用说明见 [桌面版 README](desktop/README.md)。

## P11：学习 Agent 架构与任务体验

- [x] 共享 LearningApplication：桌面与 CLI 课程、进度、资料、证据；显式工作区连接，无聊天迁移。
- [x] 长历史目标保留、资料无损分块/精确引用、完整计划校验、导入取消/重试/并发去重、mock 禁外发和数字主题修复。
- [x] 共享受控模型/工具循环与任务步骤；持久目标/约束、可选上下文整理；队列/纠正/停止/撤回/重启后手动恢复。
- [x] 实际产物哈希校验与来源，旧布尔标志失效；macOS 受限 JS 测试，结果绑定当前产物，报告与实际运行区分。
- [x] 固定自动验收/人工质量集、分 Provider 耗时诊断、主动公开版本检查。
- [x] Electron/SQLite ABI 准备；平台构建、实包 UI、SHA-256 和 draft release 工作流。
- [x] 本地 verify：64 文件 / 306 测试；专项 eval：4 文件 / 15 测试；两套开发/打包 UI；macOS 0.3.0 DMG 校验。
- [x] 当前文档、指南、Backlog 和 Evidence 同步；历史验收记录保留。

## 当前状态

P11 本机可执行开发与 macOS 验收完成，详见 [升级 Evidence](docs/evidence/agent-upgrade.md) 和 [使用指南](docs/agent-upgrade.md)。没有重跑真实 Pi/DeepSeek 请求。Windows/Intel Mac 实机、签名/公证、远端 Actions 与真实模型质量/速度仍需对应环境，不算作已验收。下一步边界见 [Backlog](docs/implementation-backlog.md)。

## 依赖安全维护

- [x] 升级 CLI/桌面 PDF.js 和内附 Pi，修复官方 CLI 启动入口，CI/发布均审计两套生产依赖；两套审计 0 漏洞、310 个测试及开发/实包 UI 回归通过。实际验收见 [依赖安全修复](docs/evidence/dependency-security.md)。
