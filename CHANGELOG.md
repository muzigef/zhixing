# 变更记录

遵循 Keep a Changelog 的记录风格；本仓库尚未对外发布稳定版本。

## [0.1.0] - 2026-07-18

### Added

- 本地学习状态机、Reviewer、主题隔离、审计与恢复。
- PDF/Markdown 资料库、FTS5 引用检索、受确认的记忆与备份恢复。
- Provider 路由、`ZHIXING_ALLOW_LIVE_PROVIDER=0` 的外发总开关、Topic Plan 与复习工作流。
- 本地 OCR、低置信度状态、本地向量兼容存储、混合检索、OS sandbox 包装和 loopback SSE 契约。
- 面试评审所需的快速开始、配置、CLI、测试、安全与贡献文档。
- SSE 进度事件、SQLite 安全恢复、最小读取范围 sandbox、OCR 超时与 CI 质量门。
- P3 个性化学习：主题学习画像、待确认的个性化计划、资料概览、Skill 草案与显式启用。
- 模型无关的本地学习建议；可选 provider 建议只发送画像和资料文件名。
- Provider 审计改为记录实际执行的 Provider，受控 fallback 记录为 `mock`。
