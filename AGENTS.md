# 知行项目约束

本文件是仓库开发指令，也由从项目目录启动的 Pi 加载。它提供行为规则；Pi 工具的路径、命令和网络限制由 `.pi/extensions/zhixing-guard.ts` 强制执行。桌面打包运行时加载 `desktop/runtime-AGENTS.md` 的副本，不将本文件作为聊天任务指令。

## 目标与顺序

1. 以当前用户任务和 `TASKS.md` 为准，按 `docs/ai-execution-protocol.md` 完成可验收切片；P0 固定顺序是历史记录，不重新执行已完成任务。
2. 每个切片先写失败/边界测试，再做最小实现。
3. 验证前安装根目录与 `desktop/` 两套依赖。行为变更至少运行 lint、类型检查和相关测试；完整 `npm run verify` 包含根目录/桌面类型检查、全部 Vitest、integration、eval 和 mock smoke。
4. 只能依据真实命令输出报告完成；更新 `docs/evidence/` 记录已验证、未验证和风险。

## 数据与隐私

- CLI 初始角色路由为本地 mock；桌面默认 Pi Codex，失败时显示错误，可手动切换 DeepSeek 或离线 demo。`ZHIXING_ALLOW_LIVE_PROVIDER=0` 是禁止真实请求的总开关；CLI 发送当前主题受限上下文并标记为用户材料，桌面发送有界会话上下文，并仅在本会话明确授权后加入当前主题的受控学习资料。
- 只允许通过受控 Runtime 从 `inbox/<topicId>/` 显式导入资料；模型工具不得直接读取或改写 `inbox/`、`data/`、`db/`、`learning-notes/`。
- 不得读取、写入、输出或提交 API Key、token、Cookie、认证文件、`.env`、`auth.json`、`.ssh` 或 `.codex` 内容。
- 知行应用的真实 Provider 在已配置时默认可用；设置 `ZHIXING_ALLOW_LIVE_PROVIDER=0` 后 adapter 必须拒绝调用。该开关不影响 Pi/Codex 开发会话。
- 不得删除用户资料、主题、数据库或审计；需要时先报告影响范围并等待用户确认。

## 工程边界

- 只修改当前 `zhixing/` 项目内的实现、测试、主题计划、Skill、文档和非敏感夹具。
- 不执行 git commit、push、reset、clean、外部网络下载、系统权限变更或通过 bash 启动 `codex` CLI。
- 使用 `./scripts/pi-safe.sh` 启动 Pi 原生 Codex Provider；不要将 `codex exec` 当作受 Pi 工具限制的子 Agent。
- 不得使用 `it.skip`、`it.only` 或忽略失败退出码；每个切片完成前运行 `npm run verify`。
- 不因未实现功能而引入 Web、向量库、OCR、多 Agent 或范围外依赖。

## P10 已授权的桌面范围

- 用户已授权可安装桌面应用及 Pi Codex / DeepSeek API 切换。`desktop/` 可以使用 Electron、React、必要的渲染和打包依赖。
- 桌面内附 Pi 可使用等价的无 shell 启动器，必须保留同一工具守卫、空工具列表、协议检查和联网总开关。
- 桌面用户数据存入独立系统应用目录；新 API 配置仅经受控主进程使用系统加密存储，不得输出或提交明文密钥。
- 桌面行为变更运行根目录 `npm run verify`、`desktop/` 的 `npm run test:ui`，交付安装包前验证实际打包应用。纯文档更新核对源码、命令、链接和历史证据，不将既有 UI/真实模型验收说成本次重跑。

## 约束冲突或阻塞

遇到凭证、外发资料、删除数据、提高配额、需要全局安装、三次修复仍失败，或设计冲突时，立即停止并报告：阻塞点、影响、已尝试内容、推荐方案和所需确认。

## P12 已授权的桌面增强

- 桌面 Pi 使用仅模型能力的公共 SDK worker，工具 schema 作为数据交给模型；工具执行统一经过应用 ToolHarness。CLI Pi 的空原生工具限制不变。
- 当前范围包含交互卡/分支、持久任务、后台整理、可选 loopback 语义检索、独立课程检查、技能预览、完整备份及会话迁移。数据导出与恢复由产品内用户操作触发。
- 本轮记录和已知外部验收见 `docs/evidence/agent-next.md`，不得将 mock 或 SDK 导入检查当作真实 Provider 成功。
