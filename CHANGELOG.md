# 变更记录

遵循 Keep a Changelog 的记录风格；本仓库尚未对外发布稳定版本。

## 未发布文档更新

- 按 `6b87f51` 的实际代码同步使用、架构、配置、开发、测试、安全与任务文档。
- 区分桌面对话与 CLI 学习能力、两套数据/设置、历史验证结果和当前未完成项。
- 修正计划解析、分块、引用核验的过度承诺，记录 CI 桌面依赖安装缺口；本次仅更新文档。

## 桌面预览 0.2.0 - 2026-09-05

对应桌面包 `zhixing-desktop@0.2.0` 与提交 `6b87f51`；CLI 根包版本仍为 `0.1.0`。这是本地预览构建记录，不代表已经发布 GitHub Release。

- 新增 Electron/React 桌面对话应用：会话侧栏、流式回答、历史与草稿恢复、停止/继续/重试、标题搜索与重命名、Markdown 导出、代码/回答复制、KaTeX 与主题设置。
- 内附 Pi 0.80.7；支持 Pi Codex / DeepSeek API / 离线演示，Codex 失败后可在同一会话切换 DeepSeek 重试。
- 新增独立系统应用目录、原子保存、受校验 IPC、系统加密凭据存储和旧 macOS Keychain 兼容。
- macOS arm64 `.app`、DMG、ZIP 已本地验收；Windows 只有 NSIS 配置，Intel Mac、签名、公证和自动更新尚未交付。
- 既有 CLI 的课程、资料、检索工具和进度尚未进入桌面。真实 DeepSeek 短请求成功，Pi Codex 真实认证仍待复测。详见 [桌面证据](docs/evidence/desktop-app.md)。

## CLI 持续改进 - 2026-09-05

对应提交 `c7f8891`，根包版本未变更。

- 接入 DeepSeek 多轮工具续写，强化取消、超时、流结束校验、运行预算、路径隔离和教学检查点。
- 普通问答与计划管理分流，增加主题回答风格、自然练习/答案处理、终端 Markdown 及更严格的引用位置校验。
- 持久化普通对话；支持生成中输入队列、即时状态、停止/调整、恢复、继续/重试和多行输入。
- 增加 `pi-codex` Provider，继承 Pi 的 Codex 模型/推理设置，使用受控启动器与空工具列表。详见 [证据索引](docs/evidence/README.md)。

## [0.1.0] - 2026-07-18

### Added

- 本地学习状态机、Reviewer、主题隔离、审计与恢复。
- PDF/Markdown 资料库、FTS5 引用检索、受确认的记忆与备份恢复。
- Provider 路由、`ZHIXING_ALLOW_LIVE_PROVIDER=0` 的外发总开关、Topic Plan 与复习工作流。
- 本地 OCR、低置信度状态、本地向量兼容存储、混合检索、OS sandbox 包装和 loopback SSE 契约。
- 快速开始、配置、CLI、测试、安全与贡献文档。
- SSE 进度事件、SQLite 安全恢复、最小读取范围 sandbox、OCR 超时与 CI 质量门。
- P3 个性化学习：主题学习画像、待确认的个性化计划、资料概览、Skill 草案与显式启用。
- 模型无关的本地学习建议；可选 provider 建议只发送画像和资料文件名。
- Provider 审计改为记录实际执行的 Provider，受控 fallback 记录为 `mock`。
