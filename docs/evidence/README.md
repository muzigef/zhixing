# 验证证据索引

截至 2026-09-09，当前交付为 0.9.0，包含三种平台实际包验收与本机安装；具体来源与质量边界见最新记录。Evidence 是各次实际执行的快照：保留原始测试数量、失败和未验证项，不将历史结果追改成今天的结果。现行功能见 [功能与验收](../features-and-acceptance.md)，配置见 [配置](../CONFIGURATION.md)。

## 最近交付

| 记录 | 范围与适用性 |
| --- | --- |
| [本机钥匙串补验](local-keychain-20260909.md) | 已安装 0.9：真实原生加解密、合成配置保存、重启解密及原生 smoke 通过；真实凭据未读取 |
| [验收对齐与 Pi 复验](acceptance-next.md) | 原配置 HTTP 200、已安装 0.9 的 11 项真实检查/项目六项；共享格式与验收统计修复，Pi 内容 20/24，仍非全通过 |
| [0.9 剩余任务验收](completion-0.9.md) | 图片、Windows 原生隔离/实际 NSIS 安装、两种 Mac 实包、真实 MCP/语义模型/通知；622 项测试，开放回答质量未全达标 |
| [0.9 回答质量复核](completion-quality-review.md) | 完整原答与绑定哈希的开发助手评分，严格主集仅 9/24；不是独立人类或学习效果评价 |
| [0.9 最终平台回执](completion-platforms.json) | Mac ARM/Intel 与 Windows 各自成功 job、具体提交、步骤和 artifact；原失败结果保留 |
| [0.9 本机安装回执](completion-local-acceptance.json) | 安装、源码来源、DMG/ZIP 哈希及各次验收快照；本机系统授权与远端加密检查分别记录 |
| [0.8 架构修复](architecture-remediation.md) | N01–N10、603 项测试、macOS ARM64 实包与双审计的历史基线 |
| [0.7 统一执行策略](unified-agent.md) | 桌面与 CLI 共用 AgentService、Pi worker、记忆和长对话策略 |
| [0.6 架构与教学增量](agent-architecture-next.md) | C01–C12、553 项测试、开发/实包各五组 UI、双 Provider 项目及完整产品协议接入；保留真实回答失败和待评分项，不宣称真实教学效果 |
| [0.6.0 本地交付清单](delivery-0.6.0-20260908.json) | macOS arm64 DMG/ZIP 校验、330 文件源码哈希、实际应用 UI；未正式发布、未签名公证 |
| [教学效果验证](learning-outcomes-20260907.md) | 学前/学后/72 小时复习、同模型两种方式、帮助声明、报告去重和备份恢复；359 测试、四套 UI、Pi 合成接入通过，真实学习效果待验 |
| [0.4.1 Pi 延迟修复](pi-latency-fix-20260907.md) | 正式 SSE、逐轮计时/可见阶段、结构化进度与减少重复查询；347 个测试、实包模型/UI 和 DMG 验证通过 |
| [Pi 延迟原因分析](pi-latency-analysis-20260907.md) | 18 个真实合成任务、27 轮模型请求，分阶段计时、SSE/推理档位对照与待开发优化项 |
| [依赖安全修复](dependency-security.md) | PDF.js 与内附 Pi 依赖升级、官方 CLI 入口、两套生产依赖审计及回归结果 |
| [Pi 登录后可用性](pi-availability-20260907.md) | 2026-09-07 两次 SDK 问答及 0.4 实包文本、工具续写均成功，含真实耗时 |
| [0.4 Agent 能力优化](agent-next.md) | 结构化上下文、执行恢复、交互/检索/检查、备份迁移与真实质量结果 |
| [0.3 学习任务升级](agent-upgrade.md) | 共享学习服务、任务/上下文、真实产物、本地验证、306 个测试、开发/实包 UI 与 0.3 DMG；外部验收单列 |
| [文档同步](documentation-sync.md) | 此前按代码核对全部项目文档、修正事实与链接、记录现存缺口 |
| [P10 桌面应用](desktop-app.md) | macOS arm64 本地 `.app`/DMG/ZIP、281 个测试、开发与打包应用 UI、DeepSeek 最小真实请求；Pi 认证与 Windows 未通过真实验收 |
| [P9 Pi Codex](pi-codex-integration.md) | 配置继承、协议/取消/身份校验；当时 267 个测试，真实认证失败 |
| [P8 连续对话](fluent-conversation-audit.md) | 持久聊天、输入队列、即时停止/调整、多行输入；当时 249 个测试 |
| [P7 交互质量](interaction-quality-audit.md) | 自然路由、风格、练习、输出和引用；当时 221 个测试 |
| [P6 运行时审查](agent-runtime-audit.md) | DeepSeek 工具续写、取消/预算/路径和状态加固；当时 167 个测试 |

P6–P9 后续合入 `c7f8891`，P10 合入 `6b87f51`。旧记录中的“未提交/未推送”描述的是写下该记录的时点，不是当前仓库状态。

## 早期阶段

| 记录 | 内容 |
| --- | --- |
| [基础](foundation.md) | 最早 CLI、主题、资料索引、Pi 守卫验证 |
| [B01–B03](b01-b03.md) | 资料引用、运行审计、Reviewer |
| [B04–B06](b04-b06.md) | 记忆、删除/备份、Codex CLI 初版 |
| [B07](b07.md) | Skill Catalog 与主题资源 |
| [B08](b08.md) | 版本化计划与复习 |
| [E01–E31](e01-e31-coverage.md) | 历史 P0 验收映射，分布在多个测试文件，不是 eval 脚本含 31 个用例 |
| [P1](p1-acceptance.md) | 课程、资料问答、计划与 session |
| [P2](p2-acceptance.md) | 本地 OCR/向量、受限执行、本机 HTTP/SSE |
| [P3](p3-personal-learning.md) | 画像、计划、Skill 草案和建议 |
| [P4](p4-learning-orchestration.md) | 主题创建、定制课程、提醒计划 |
| [风险收口](risk-remediation.md) | SSE、sandbox、SQLite 恢复、OCR 与 CI 初版 |
| [早期 Provider smoke 状态](provider-live-smoke.md) | 当次跳过真实请求的历史记录 |
| [DeepSeek 最小 smoke](deepseek-smoke.md) | 独立最小真实请求，不代表持续可用性或内容质量评测 |

## 如何解释结果

自动化合成响应验证协议、状态和边界，不证明真实模型教学质量。模型配置可读取不证明认证成功。单次首字耗时不是长期性能基准。系统加密抽象通过单测不等于各 OS 的真实新密钥保存已验收。签名、平台构建和安装包发布分别需要自己的证据。

完整本地检查与独立桌面 UI/安装包测试步骤见 [测试指南](../TESTING.md)。CI 已安装并审计根目录与桌面两套依赖；远端通过状态以 GitHub Actions 实际运行结果为准。
