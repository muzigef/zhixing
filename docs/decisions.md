# 当前产品决策

> 核对日期：2026-09-05，桌面 0.3.0 升级。本文记录当前实现采用的决策；交付状态见 [任务台账](../TASKS.md)。

## 主题与本地数据

- 内置主题为 `agent-development`、`rag`、`tool-calling`、`interview-project`；用户可创建额外的受控本地主题。
- 主题间默认隔离：计划、进度、资料、记忆、审计与教学 session 都以 `topicId` 为边界。
- 当前主题、本地路由、用户创建主题与学习记录都是本地状态，均不应提交到 Git。
- CLI 支持删除资料与记忆、手动备份/确认恢复数据库；尚不支持主题删除、自动备份、学习资料整体导出或云同步。桌面已支持单会话 Markdown 导出。

## Provider 与隐私

- CLI 角色 `tutor`、`reviewer`、`lab` 初始路由为 `mock`，可独立切换至 `deepseek-api`、`codex-cli` 或 `pi-codex`；路由保存在本地设置。当前真实教学和工具助手使用 tutor，Day Review 仍为确定性代码。
- 已配置的真实 Provider 默认可用；`ZHIXING_ALLOW_LIVE_PROVIDER=0` 会禁止真实调用。
- CLI 的 DeepSeek API Key 使用 macOS Keychain；桌面优先使用系统加密的独立凭据文件，未配置时可复用旧 macOS Keychain。Codex CLI 与 Pi 各自负责认证；知行不直接读取它们的认证文件。桌面新 Key 只通过主进程受控保存，不能写入偏好 JSON 或聊天记录。
- 资料问答发送检索证据；学习建议发送画像与资料名称；教学和自然交互仅发送当前主题受限上下文。审计不保存 prompt、回答或凭证。
- 明确选择 Provider 的教学/自然交互失败时显示错误，不会静默改由 mock；允许 fallback 的调用可降级。
- Pi 模型调用固定 `openai-codex`、已配置模型和推理强度，不猜测其他 Provider；桌面 Pi/Codex 失败后由用户点击切换 DeepSeek 重试。

## 学习、资料与记忆

- Day 完成由确定性证据 Review 控制，模型不能自行推进计划。
- 支持 PDF/Markdown、本地 OCR、FTS5 与本地 HashEmbedding 混合检索；当前不支持 DOCX、sqlite-vec 或云端 embedding。
- 单文件上限 250 MiB、PDF 上限 500 页、单主题资料上限 2 GiB；当前为代码常量。
- 当前长期记忆只能由 `记住 <内容> --确认` 写入；reviewer 或 RAG 自动写记忆尚未接入。

## 运行与质量

- CLI 与源码开发的 Node 版本固定为 `24.8.x`，SQLite 使用 `better-sqlite3`。已打包桌面自带 Electron/Node 与 Pi，不依赖系统 Node 或 SQLite 原生模块。
- Codex 调用为只读、临时、无审批的 `codex exec --json` 文本流；DeepSeek 使用 SSE。
- `npm run verify` 是本地发布质量门；真实 Provider smoke 为可选环境验收。

## 桌面交付

- `desktop/` 是独立 Electron + React 包，版本 `0.3.0`；CLI 包版本仍为 `0.1.0`。
- 保留学习 Agent 定位；提供连续对话、任务队列/纠正、持久目标/摘要，并通过共享应用服务接入课程、资料、进度与实际产物 Review。任意 Shell、编程文件编辑、多 Agent 和插件市场不在本轮范围。
- 桌面默认偏好为 Pi Codex、自然回答（`adaptive`）、系统主题；DeepSeek 模型默认 `deepseek-v4-flash`。用户保存的偏好覆盖默认值，桌面设置与 CLI 路由相互独立。CLI 将同一 `adaptive` 风格标为“适中”。
- 应用数据写入系统应用数据目录下的 `Zhixing`，不自动搬迁 CLI 数据。API Key 使用系统加密，但会话 JSON 和草稿并非应用级加密。
- 实际交付为 macOS Apple Silicon 本地 `.app`、DMG、ZIP；Windows 有构建/实际包 UI 流水线，实机仍未验收。当前没有 Apple Developer ID 签名、公证或公开安装包发布记录。
- 桌面打包 Pi 通过 Electron Node 模式启动，保留守卫与空工具列表；renderer 不接触 Node、任意文件读写或凭据读取接口。

- 工作区采用显式连接，不自动数据迁移；队列恢复需用户触发，未成功保存的排队请求不能执行。
- Review 区分用户报告、实际提交副本与应用执行结果。完整性达标可推进 Day，但不宣称能力评分或普遍正确性。
- 本地 JS 测试仅在 macOS 受限沙箱运行；不支持的平台明确拒绝。
- 版本检查只提供公开发布说明；发布流水线生成待发布草稿与校验和，签名/公证依赖实际证书。
