<!-- generated-by: gsd-doc-writer -->
# 当前产品决策

> 核对日期：2026-09-11，桌面0.11.0当前实现。本文记录当前实现采用的决策；交付状态见 [任务台账](../TASKS.md)。

## 主题与本地数据

- 内置主题为 `agent-development`、`rag`、`tool-calling`、`interview-project`；用户可创建额外的受控本地主题。
- 主题间默认隔离：计划、进度、资料、记忆、审计与教学 session 都以 `topicId` 为边界。
- 当前主题、本地路由、用户创建主题与学习记录都是本地状态，均不应提交到 Git。
- CLI 支持删除资料与记忆、手动备份/确认恢复数据库；尚不支持主题删除、自动定时备份或云同步。桌面已支持单会话 Markdown 导出及包含资料、笔记、项目、会话与执行数据的完整工作区备份，恢复到新目录并清除授权。

## Provider 与隐私

- CLI 角色 `tutor`、`reviewer`、`lab` 初始路由为 `mock`，可独立选择内置/自定义 API、Pi 或已启用的官方 Agent 执行器；`codex-cli` 旧ID保留为官方Codex兼容路由；路由保存在本地设置。当前真实教学和工具助手使用 tutor，Day Review 仍为确定性代码。
- 已配置的真实 Provider 默认可用；`ZHIXING_ALLOW_LIVE_PROVIDER=0` 会禁止真实调用。
- CLI 的 DeepSeek、Kimi 及自定义 API Key 使用 macOS Keychain；桌面优先使用系统加密的独立凭据文件，未配置时可复用旧 macOS Keychain。Codex CLI 与 Pi 各自负责认证；知行不直接读取它们的认证文件。桌面新 Key 只通过主进程受控保存，不能写入偏好 JSON 或聊天记录。
- 资料问答发送检索证据；学习建议、教学和自然交互经同一共享服务；仅在授权后加入当前主题的有界画像、记忆、资料和学习快照，授权后的工具可读取其范围内内容，不能将外发范围概括成仅文件名。审计不保存 prompt、回答或凭证。
- 明确选择 Provider 的教学/自然交互失败时显示错误，不会静默改由 mock；允许 fallback 的调用可降级。
- Pi 模型调用固定 `openai-codex`、已配置模型和推理强度，不猜测其他 Provider；桌面 Pi/Codex 失败后由用户点击切换 DeepSeek 重试。

## 学习、资料与记忆

- Day 完成由确定性证据 Review 控制，模型不能自行推进计划。
- 支持 PDF/Markdown、本地 OCR、FTS5 与本地 HashEmbedding 混合检索；当前不支持 DOCX、sqlite-vec 或云端 embedding。
- 单文件上限 250 MiB、PDF 上限 500 页、单主题资料上限 2 GiB；当前为代码常量。
- 当前长期记忆只能由 `记住 <内容> --确认` 写入；reviewer 或 RAG 自动写记忆尚未接入。

## 运行与质量

- CLI 与源码开发的 Node 版本固定为 `24.8.x`，SQLite 使用 `better-sqlite3`。已打包桌面自带 Electron/Node 与 Pi，不依赖系统 Node 或 SQLite 原生模块。
- 官方 Codex 通过经版本验收的固定 argv、临时目录、空工具和受限文件权限执行仅上下文任务，默认实际模型为 `gpt-6-astra`；首次交付是完整消息，不称为流式首 token。DeepSeek、Kimi 和通用 API 使用有界协议传输。
- `npm run verify` 是本地发布质量门；真实 Provider smoke 为可选环境验收。

## 桌面交付

- `desktop/` 是独立 Electron + React 包，版本 `0.11.0`；CLI 包版本仍为 `0.1.0`。
- 保留学习 Agent 定位；提供连续对话、任务队列/纠正、持久目标/摘要，并通过共享应用服务接入课程、资料、进度与实际产物 Review。已有知行管理的独立实践项目编辑/测试/Git检查点，以及有界只读成员的同模型和异模型团队；任意 Shell、任意用户工作树编辑、成员写入与插件市场未开放。
- 桌面默认偏好为 Pi Codex、自然回答（`adaptive`）、系统主题；DeepSeek 模型默认 `deepseek-v4-flash`。用户保存的偏好覆盖默认值，桌面设置与 CLI 路由相互独立。CLI 将同一 `adaptive` 风格标为“适中”。
- 应用数据写入系统应用数据目录下的 `Zhixing`，不自动搬迁 CLI 数据。API Key 使用系统加密，但会话 JSON 和草稿并非应用级加密。
- 实际交付为 macOS Apple Silicon 本地 `.app`、DMG、ZIP；Windows 有 NSIS 构建、安装和实际包 UI 流水线，旧0.9构建验收已有记录；当前构建须单独验证，不能沿用旧结果。macOS 当前支持固定本地证书签名以保持安装身份；正式 Apple Developer ID、公证及公开发行仍需独立验收。
- 桌面打包 Pi 通过 Electron Node 模式启动，保留守卫与空工具列表；renderer 不接触 Node、任意文件读写或凭据读取接口。

- 工作区采用显式连接，不自动数据迁移；队列恢复需用户触发，未成功保存的排队请求不能执行。
- Review 区分用户报告、实际提交副本与应用执行结果。完整性达标可推进 Day，但不宣称能力评分或普遍正确性。
- 本地 JS/Python 实践测试支持 macOS 受限沙箱与 Windows AppContainer；依赖缺失或不支持的平台明确拒绝。MCP restricted 仍仅支持 macOS，不能混用两种能力。
- 版本检查只提供公开发布说明；发布流水线生成待发布草稿与校验和，签名/公证依赖实际证书。

## 通用接入与证据边界

- `AgentBackend = ModelClient | AgentExecutor` 区分逐轮模型生成与官方完整任务；同一协议新增厂商可配置，新的协议或官方运行时通过受审查适配器扩展。十家目录不是接入白名单。
- 已配置的官方 Codex 订阅、DeepSeek API、Kimi API 是当前真实回归范围；其他厂商账号、Claude真实订阅、Gemini执行器及 SDK/App Server 均按需扩展，不冒充已逐家打通。
- 同模型与异模型使用同一任务图、审查、定向复核、权限和持久预算；默认单 Agent、最多两名只读成员。不以品牌多样性推断更高质量。
- 工程测试、实际应用 UI、真实连接、回答语义质量与学习效果分别报告，历史结果绑定题目、配置和构建。当前CI和安装状态见[当前状态](current-status.md)，不以过去本机通过代替最新远端结果。
- 记忆与教学策略共用，但当前CLI命令入口仍有8,000字符限制，共享服务/桌面为20,000；这是现存入口差异，尚不能声称所有交互约束完全一致。
