# 知行全量开发计划

> 核对日期：2026-09-05；代码基线 `6b87f51`。P0–P9 的代码与本地回归已完成；P9 的 Pi Codex 真实认证尚未验收。P10 已交付 macOS Apple Silicon 桌面预览版。
> 当前入口：[任务台账](../TASKS.md)、[功能与验收](features-and-acceptance.md)、[桌面说明](../desktop/README.md)。各阶段测试数量是当时快照，不代表当前总数。

## 已完成能力

| 阶段 | 已交付内容 | 验证 |
| --- | --- | --- |
| P0：MVP 闭环 | 主题状态机、review、资料导入/FTS/citation、记忆、审计、Provider 路由、备份恢复、安全与 E01–E31 覆盖 | `npm run verify`、`e01-e31-coverage.md` |
| P1：学习体验 | Topic Plan、课程和 Skill、grounded answer、计划调整与复习、session snapshot | `p1-acceptance.md` |
| P2：本地扩展 | Tesseract OCR、低置信度状态、SQLite 向量兼容表、混合检索、macOS 受限执行、loopback Web/SSE 契约 | `p2-acceptance.md` |
| P3–P5：个性化与自然交互 | 每主题学习画像、定制课程、Skill 草案、当前主题与教学检查点恢复、受控自然语言草案、Codex/DeepSeek Provider 适配 | `TASKS.md`、`npm run test:harness` |
| P6：运行时加固 | DeepSeek 多轮工具续写、取消、流协议与预算限制、路径和教学状态加固 | [运行时审查](evidence/agent-runtime-audit.md) |
| P7–P8：对话体验 | 普通问答与计划分流、主题风格、持久会话、输入队列、停止/调整、终端 Markdown | [交互质量](evidence/interaction-quality-audit.md)、[连续对话](evidence/fluent-conversation-audit.md) |
| P9：Pi Codex | 显式继承 Pi 模型与推理偏好、安全启动器、文本流协议与取消；真实登录仍待恢复 | [Pi 接入](evidence/pi-codex-integration.md) |
| P10：桌面预览 | Electron/React、会话/草稿、流式 Markdown/公式、导出、Pi Codex / DeepSeek 切换、内附 Pi、macOS arm64 安装包 | [桌面验收](evidence/desktop-app.md) |

## 当前技术边界

- CLI 初始角色路由为 mock；桌面初始选择 Pi Codex，未配置或失败会显示错误，可手动选择离线 demo。已配置真实 Provider 默认可用；`ZHIXING_ALLOW_LIVE_PROVIDER=0` 禁止真实请求，CLI 前置材料门还可能拦截 mock 的“学习建议”。CLI 教学上下文标记为用户材料并限于当前主题，桌面只发送显式提供的有限会话上下文。
- OCR 仅使用本机 `tesseract` 与 `pdftoppm`。不可用或失败时保留 `ocr_required`，不伪造文本。
- 向量层使用可替换的本地 `HashEmbeddingModel` 和 `chunk_embeddings` SQLite 兼容表；不是云端 embedding，也不依赖 sqlite-vec 二进制扩展。
- 受限执行使用 macOS `sandbox-exec`、命令 allowlist、临时目录和超时；系统没有该工具时安全拒绝。Docker/Colima 不是依赖。
- 同步服务仅绑定 `127.0.0.1`，提供单主题 progress JSON/SSE；不包含云端账户、远程同步或冲突合并。
- 桌面与 CLI 分别保存聊天和模型偏好；经 LearningApplication 显式连接同一学习工作区，共用课程、进度、资料与真实产物证据，不自动迁移聊天。
- CLI 包版本为 `0.1.0`，桌面包为 `0.3.0`。P10 真实 DeepSeek 短请求是历史证据；本轮没有重跑真实模型。

## 后续工作原则

已知待办见 [Backlog](implementation-backlog.md)：Windows 实机和 Intel Mac 验收、签名/公证、桌面学习功能、Pi 登录复测，以及当前 CI 未安装桌面依赖的问题。未授权扩展的设想不自动作为开发任务执行。

行为修改先定义边界和失败测试；文档更新按源码、测试与已运行证据核对。完整本地质量门为 `npm run verify`；桌面交互和安装包还需单独运行真实 Electron / 打包应用 UI 验证，不能由类型检查替代。

## P11：架构与学习任务升级

共享应用服务、真实桌面学习流程、资料保真与可取消导入、完整计划校验、任务队列/纠正/目标摘要、实际产物 Review、本地 JS 验证、质量用例/耗时诊断和平台发布流水线已实现。执行清单见 [升级计划](agent-upgrade-plan.md)，真实验证结果见 [Evidence](evidence/agent-upgrade.md)。未交付范围以 Backlog 的外部环境和后续产品能力为准。
