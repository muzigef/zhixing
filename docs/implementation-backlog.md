# 实际开发 Backlog

> 核对日期：2026-09-05，代码基线 `6b87f51`。P0–P8 的阶段验收已完成，P9 有认证环境待办，P10 已完成 macOS arm64 本地预览验收。

## 已完成基线

- P0：学习状态机、Reviewer、资料库/citation、记忆、运行审计、Provider 路由与 E01–E31 本地自动化验收。
- P1：完整 Topic Plan、课程/Skill 内容、带 citation 的 grounded answer、计划调整/复习与 session snapshot。
- P2：本地 OCR 和低置信度页、本地向量兼容存储与混合检索、无 Docker 的 macOS 受限执行、loopback Web/SSE 同步契约。
- P3–P8：个性化课程与自然交互、运行账本、DeepSeek 工具续写、持久连续对话及终端输出改进。
- P9：Pi Codex 偏好继承与受控文本适配；P10：独立桌面对话、双 Provider 切换和 macOS arm64 本地安装包。

详见 [任务台账](../TASKS.md) 和各阶段 Evidence。真实 Provider smoke 仍为可选项；已配置 Provider 时默认可用，设置 `ZHIXING_ALLOW_LIVE_PROVIDER=0` 可禁止调用。

## 新需求入队标准

新项目项必须包含：用户可见目标、主题与隐私边界、失败/边界测试、验收命令和 Evidence 路径。不得以“基础实现”代替已验证闭环。

## 已知待办

| 项目 | 当前缺口 | 完成依据 |
| --- | --- | --- |
| CI 桌面依赖 | `.github/workflows/verify.yml` 只执行根目录 `npm ci`；`scripts/verify.mjs` 已增加桌面类型检查，干净 runner 尚缺 `npm ci --prefix desktop` | 补齐安装步骤并取得真实 CI 通过记录；当前文档更新未改 CI |
| Pi Codex 登录 | 最近真实调用未获得可用认证；读取到模型偏好不是登录成功 | 用户在 Pi 登录后，以无敏感内容请求复测，记录结果 |
| Windows | 已有 NSIS x64 构建配置，未构建和实机验证 | Windows 构建、安装、设置、密钥存储、对话和重启验收 |
| Intel Mac | 当前仅 arm64 产物 | 明确目标架构后构建并在对应平台运行 |
| 正式分发 | 当前没有 Developer ID 签名、公证、自动更新或安装包发布流水线 | 补齐证书与平台验收，并验证实际发布产物 |
| 桌面学习功能 | 课程、资料导入/检索、证据 Review 和进度仍只有 CLI 入口 | 明确数据共享/迁移契约，接入工作流并做桌面端到端测试 |
| 计划校验 | 已有完整 Zod 契约，但 `TopicPlanLoader` 的读取路径仍为受限解析与 fallback | 坏计划、旧格式与合法模板端到端验证；不能只增加 schema 单测 |
| 长段落分块 | 当前 `chunkText` 可能截断最后的超长段落，也不保证所有块的长度上限 | 以重建全文和稳定引用位置为标准验证保真分块 |
| CLI 导入取消 | 底层资料库有局部 signal 检查，但 CLI 未转发取消信号，普通导入没有统一总时限 | 从实际 CLI 到读取、PDF/OCR、数据库写入贯通取消与 deadline 并验证回滚 |
| 全局禁外发环境 | 全局开关为 `0` 时，“学习建议”的前置材料门也会拦截 mock；E40 测试继承该变量后失败 | 区分模型路由与内容授权，验证 mock 和真实 Provider 的预期行为及测试环境隔离 |
| Pi 开发工具守卫 | 路径和命令规则是词法检查，未覆盖符号链接解析、所有参数路径或敏感文件名变体 | 单独定义开发工具威胁边界并验证路径策略；文本模型调用继续保持空工具列表 |
| 本机同步主题 ID | HTTP 路由仅接受字母开头，核心 schema 允许数字开头；如 `3dgs` 同步请求会 404 | 统一路由与主题契约，并验证数字开头主题的 progress/SSE |

完整注册表分派、其他 Provider 的工具续写、精确 token/费用统计、语义压缩和逐步骤幂等恢复仍是后续设计；尚未作为已交付功能。更多限制见 [架构](architecture.md)。
