<!-- generated-by: gsd-doc-writer -->
# 知行（ZhiXing）

知行是面向自主学习者的本地优先学习 Agent，提供可安装的桌面对话应用，以及管理主题、资料、课程和学习进度的 CLI / REPL。

当前根包 `zhixing-learning-agent` 为 `0.1.0`，桌面包 `zhixing-desktop` 为 `0.3.0`。两者复用学习应用服务、模型适配器和回答规范。聊天与偏好分别保存；桌面可显式连接 CLI 工作区，共用课程、资料、证据和进度。

| 入口 | 当前能力 | 默认模型设置 |
| --- | --- | --- |
| 桌面版 | 连续对话、流式回答、公式排版、会话搜索与恢复、草稿、停止/继续/重试、复制和 Markdown 导出 | 新数据目录默认 `pi-codex`；可切换 `deepseek-api` 或离线 `demo` |
| CLI / REPL | 主题、资料库、课程与进度、个性化计划、教学练习、证据 Review、受控学习工具 | 无本地路由设置时，tutor / reviewer / lab 均为 `mock` |

桌面现已接入课程、进度、资料导入与引用、真实产物验收、任务排队与纠正、持久目标及耗时诊断。完整使用步骤见 [0.3 升级指南](docs/agent-upgrade.md)。

## 快速开始

### 使用桌面版

已有本地构建产物时，打开 `desktop/release/Zhixing-0.3.0-mac-arm64.dmg`，将「知行」拖入 Applications 后启动。该安装包面向 macOS Apple Silicon；按 [2026-09-05 验证记录](docs/evidence/desktop-app.md)，实际应用要求 macOS 13.0 或更高版本。

在设置中选择 **Pi · Codex** 或 **DeepSeek API** 后发送问题；尚未配置模型时，可先选择「离线演示」检查交互。切换方式会保留当前会话，Codex 回答失败时也可点击「切换到 DeepSeek 重试」。认证准备见下方 [Provider 配置](#provider-配置)。

安装包已内附 Electron 和 Pi 运行环境，运行应用不需要系统 Node.js 或 Pi 可执行文件。Pi 登录与模型偏好仍需事先在 Pi 中配置。当前产物是无 Apple Developer ID 签名、公证的本地预览版；`desktop/release/` 被 Git 忽略，不随源码克隆分发。已有 macOS/Windows 构建与 draft release 流水线；Windows 和 Intel Mac 尚未实机验收。设置可主动检查公开新版本，不会自动替换安装。

桌面安装、快捷键和平台构建步骤见 [桌面版 README](desktop/README.md)。

### 从源码运行

前置条件：Node.js `24.8.x` 与 npm。CLI 会检查 Node 版本；处理扫描 PDF 的 OCR 才需要额外安装 `tesseract` 和 `pdftoppm`。

```bash
git clone https://github.com/muzigef/zhixing.git
cd zhixing
npm ci
npm ci --prefix desktop
```

启动桌面应用：

```bash
npm run desktop
```

或使用 CLI / REPL：

```bash
npm run start -- '主题列表'
npm run repl
```

没有配置真实 Provider 时，CLI 使用本地 mock；学习状态操作可本地运行，自然生成的回答需要配置真实 tutor。在 REPL 中可以使用：

```text
/help
学习 agent-development
/style balanced
解释 RAG 和微调的区别，用表格比较
开始第 1 天
来一道题
/status
```

执行 `学习 <主题>` 后，下次进入 REPL 会恢复该主题及其当前对话。CLI 普通聊天保留最近 6 轮，每轮用户输入和回答各保留最多 8,000 字符，另行保存最初目标；这与桌面的保存和上下文限制不同。

RAG 课程要求先完成 `agent-development/D01` 和 `D02`；上面的入门示例从无跨主题前置条件的 Agent 开发主题开始。

## CLI 核心能力

- 主题化学习：选择或创建主题，保存当前主题，重启后恢复学习上下文。
- 课程与进度：按 Day 推进，前置条件与 Review 证据决定是否可以进入下一阶段。
- 个性化计划：学习画像、个性化计划、定制课程与 Skill 草案均可本地生成和启用。
- 自然问答与教学：无需先建计划即可提问；支持追问、举例、教学代码、练习、参考答案和有原文依据的作答批改。
- 连续对话：普通问答按主题自动保存，重启接着聊；支持新对话、恢复旧对话、继续和重试。
- 回答体验：生成时可继续输入、即时查看状态、停止或调整要求；支持多行粘贴、按主题保存回答风格，以及保留代码和公式的 Markdown 显示。
- 本地资料库：导入 Markdown/PDF，扫描 PDF 可选本地 OCR；SQLite FTS5 与本地向量混合检索，资料问答要求可定位引用。
- 多 Provider：`mock`、`deepseek-api`、`codex-cli`、`pi-codex` 可按 tutor/reviewer/lab 角色路由；真实 Provider 支持文本流。
- 受控 Agent runtime：统一输入分类、模型计划确认、运行账本、脱敏审计；DeepSeek 支持真实多轮工具调用，工具 schema/主题/风险/取消/超时以及总轮次、事件和上下文均受运行时限制。

## CLI 常用流程

### 创建或定制学习计划

真实 tutor 已配置时，可以直接用自然语言描述学习目标，例如：

```text
创建 3DGS 的学习计划
```

知行会追问缺失信息并生成可执行草案。看到草案后说 `就按这个来`、`好，执行吧` 或 `直接运行`，即可执行受支持的动作；高风险操作仍要求 `直接运行 --确认`。

也可以完全不使用模型：

```bash
npm run start -- '设置学习画像 掌握 RAG 原理与实践 --水平 初学 --每天 45 --周期 14' --topic rag
npm run start -- '生成个性化计划' --topic rag
npm run start -- '启用个性化计划 personal-plan-<version> --确认' --topic rag
npm run start -- '生成技能草案 rag-retrieval' --topic rag
npm run start -- '启用技能草案 rag-retrieval --确认' --topic rag
```

### 导入与查询资料

先将资料放入 `inbox/<topicId>/`，再导入：

```bash
npm run start -- '导入资料 rag/notes.md'
npm run start -- '查询资料 rag 如何提供可定位引用'
npm run start -- '资料问答 检索如何提供引用 --允许外发' --topic rag
```

资料默认在本机处理。资料问答若没有足够证据或缺少引用，会返回 `insufficient_evidence`。

### 使用受控学习助手

已配置 DeepSeek 后，可以让模型主动查询进度或资料，并根据工具结果继续回答：

```text
模型切换 tutor deepseek-api --确认
根据我的进度建议下一步
结合已导入资料解释 RAG 的引用机制 --允许外发
```

普通自由问答可直接使用工具，无需 `学习助手` 前缀；显式前缀仍兼容。助手默认只能读取当前主题的进度和资料目录；本次命令末尾带 `--允许外发` 才开放资料正文检索。工具错误会反馈给模型以调整查询；总计最多 6 轮、32 次工具请求和 180 秒。教学阶段保留原有教学流程；mock、codex-cli 和 pi-codex 文本适配器不支持知行工具调用。

### 学习中的自然交互

真实 tutor 的单日流程是：讲解 → 答疑 → 练习 → 实验与证据 Review。

- 可以先直接提问，不必建立画像或课程；教学中也可随时说 `举个例子`、`简短一点`、`用代码说明`。
- 要练习时说 `开始练习`、`来一道题` 或 `出两道题`；默认一题，明确数量和题型时按要求生成。旧口令 `没有问题，开始练习` 仍兼容。
- 练习中可说 `给答案`、`给出参考解析`、`换一道题`；索要提示或答案不会记作用户作答。
- 只有实际输入且可验证的作答会进入批改；模型不能把自己的内容当成用户答案。
- 先用 `提交证据 DNN <implementation|testOutput|failureCase|reflection> <实际内容>` 保存产物，再执行 `检查 DNN`。旧布尔参数不再作为证据；分数表示完整性，不是掌握程度。

`/style concise`、`/style balanced`、`/style detailed` 分别设置当前主题的简洁、适中、详细风格，重启后保留；也支持 `回答风格 简洁` 等中文形式。本轮的“只要结论”“详细推导”“用表格”等要求优先于默认风格。

`/status` 查看主题、教学阶段和风格；`/cancel-plan` 或 `取消草案` 取消待执行草案，继续问答；`/plan <需求>` 明确进入计划管理。计划草案和教学可以并存，知识问题不会因出现“模型”“课程”等词而退出教学。

### 连续聊天与中途调整

生成期间可以继续输入，普通消息按顺序处理。输入 `等等，用生活例子解释` 或 `/steer 新要求` 会停止当前文本生成，结合原问题和已生成内容继续回答；`停止` 或 Ctrl-C 只停止当前回答。`/status` 随时查看处理状态与排队数量，`/queue clear` 撤回尚未处理的消息。

- `继续`、`接着说`：有对话上下文时接着回答；`重试` 或 `/retry` 重问上一条请求。
- `/new`：开启新对话，原对话保留；`/resume` 列出当前主题最近 20 个对话，再用 `/resume <编号>` 恢复。
- `/paste`：进入多行输入，粘贴代码或长问题后单独输入 `/send` 发送；`/cancel-input` 撤销。也可以用行末反斜杠换行。

会话恢复不会回滚学习进度或教学检查点。正常停止会保存已生成的部分回答；进程被强制结束时，可能只保留请求和最后一次已保存的内容。

终端支持标题、列表和强调，代码围栏、表格和 LaTeX 公式保留文本。`NO_COLOR=1` 或输出重定向时保留可复制的 Markdown，不加入终端颜色。当前终端不进行公式排版，回答要求在公式后附中文解释。短段落约每 80 毫秒刷新，无需等待换行；输入草稿时暂存新增显示，提交或取消后再显示，避免和输入挤在一行。`/exit` 退出。

## Provider 配置

### 桌面设置

- **Pi · Codex**：读取 Pi 的模型偏好，由 Pi 自己处理认证和刷新；知行不读取认证文件。设置页「已读取 Pi 模型配置」仅代表偏好可用，登录有效性在发送时检查。
- **DeepSeek API**：默认模型 `deepseek-v4-flash`，界面也提供 `deepseek-v4-pro`。优先使用桌面保存的配置；macOS 上没有桌面配置时，可复用原 CLI 写入的知行 Keychain 项。新 Key 通过主进程使用系统加密后保存，不能从界面读取回原值。找到配置不代表 API 已连通。
- **离线演示**：本地固定演示内容，不调用真实模型。

桌面 Provider、模型和回答风格保存在独立的 `preferences.json`，不会改变 CLI 的角色路由。桌面内新增的加密 Key 也不会同步写入 CLI Keychain。两端回答风格均保存为 `concise` / `adaptive` / `detailed`；CLI 还接受 `balanced` 作为 `adaptive` 的输入别名。桌面风格按应用保存，CLI 风格按学习主题保存。

### CLI 角色路由

无本地设置时默认使用 `mock`。在 REPL 中添加 DeepSeek Key 或切换 tutor：

```text
模型添加 api-key deepseek-api
模型切换 tutor deepseek-api --确认
模型切换 tutor codex-cli --确认
模型切换 tutor pi-codex --确认
模型状态
```

这些切换命令是可选操作；执行最后一条切换后，tutor 使用 `pi-codex`。reviewer 和 lab 的路由需分别设置。CLI DeepSeek Key 使用隐藏输入写入 macOS Keychain，当前没有其他平台的 CLI 凭据存储适配；默认 DeepSeek 模型可通过 `ZHIXING_DEEPSEEK_MODEL` 覆盖。`codex-cli` 需要系统中已安装并登录的官方 Codex CLI，与 Pi 的认证独立。

### Pi 配置与启动方式

Pi 默认 Provider 必须为 `openai-codex`，并已选择模型和完成登录；模型 ID 不写死在知行中。每次调用读取 `${PI_CODING_AGENT_DIR}/settings.json`（未设置时为 `~/.pi/agent/settings.json`），再合并调用工作目录内的 `.pi/settings.json`，同名项目设置优先。

- CLI 的调用工作目录是代码仓库，通过 `scripts/pi-safe.sh` 启动系统 `pi`，因此需另行安装 Pi 并使 `pi` 和 `bash` 可用；根包 `npm ci` 不会安装 Pi。
- 桌面调用工作目录是系统应用数据目录下的 `runtime/`，通过无 shell 启动器运行内附 Pi `0.80.7`，不会自动读取源码仓库的 `.pi/settings.json`。

两种 Pi 接入都使用 JSON 文本流、临时会话、同一工具守卫和空工具列表。CLI 的普通问答、教学、计划生成和资料问答由知行自身流程处理；Pi 的文件与命令工具不开放给模型。Pi 错误会明确提示，桌面由用户选择切换 DeepSeek 重试，不会静默改用其他模型。

设置进程环境变量 `ZHIXING_ALLOW_LIVE_PROVIDER=0` 可禁止真实 Provider 请求。CLI 发送当前任务的受限主题上下文；桌面发送本轮输入、目标、约束、受限历史及可选摘要；只有授权会话才增加当前主题学习上下文。Provider 所需凭据仅用于认证，不拼入模型提示词；审计原文和其他主题资料不加入上下文。资料正文的额外授权规则见 [配置说明](docs/CONFIGURATION.md)。

## 安全与运行模型

以下账本、主题授权和工具规则适用于 CLI 学习运行时：

- 每轮输入都先经过统一控制层；模型输出只能提出建议，不能自行执行写操作或把推断写成用户事实。
- 删除资料、恢复数据库、切换模型、启用计划/Skill 等高影响操作需要显式确认。
- 经过 RunManager 的业务操作有 SQLite 运行/步骤账本与脱敏审计；帮助、即时状态等控制命令不逐一入账。中断运行会标记为 `process_interrupted`，不会自动重放可能写入的操作。
- 工具调用统一经过 schema 校验、主题边界、风险授权、强制超时和输出上限。
- Provider trace 记录 Provider、角色、耗时、状态、事件数、回合数和工具调用数；不记录 prompt、回答或工具参数。

输入 `诊断` 可查看当前主题、Provider、教学检查点、资料、记忆、提醒与最近运行摘要。

桌面聊天使用独立 JSON 存储，学习功能通过共享 LearningApplication 操作工作区 SQLite 与笔记；模型任务记录统一运行步骤。renderer 开启 sandbox、context isolation 和本地内容策略；文件导出、系统剪贴板、外部链接、模型请求与密钥保存均通过受校验的主进程命令。桌面 DeepSeek 可执行受授权的只读学习工具；任意文件或 Shell 工具不开放给模型。

## 数据目录

CLI 默认把仓库父目录作为数据根目录，也可用 `ZHIXING_ROOT` 指定；其下使用固定的 `zhixing/` 和 `learning-notes/` 子目录。按上述命令克隆为 `zhixing` 时，结构为：

```text
<仓库父目录>/
  zhixing/
    data/       # 主题 session、审计与资料数据（忽略提交）
    db/         # SQLite 元数据、检索索引与记忆（忽略提交）
    inbox/      # 待导入资料（忽略提交）
    settings/   # 本机主题与模型路由设置（忽略提交）
  learning-notes/
    topics/     # 主题学习记录（位于源码仓库之外）
```

CLI 用户新建主题还会写入 `zhixing/topics/<topicId>/`，与已跟踪的内置主题资源区分。更改数据根目录前请参阅 [配置说明](docs/CONFIGURATION.md)。

桌面保存在 Electron `appData` 下的 `Zhixing/`，macOS 默认位置为 `~/Library/Application Support/Zhixing/`：

```text
Zhixing/
  conversations/       # 每会话一个 JSON 文件
  preferences.json     # 桌面 Provider、模型、风格和主题
  deepseek.credential  # 可选的系统加密 Key
  runtime/             # 内附 Pi 的隔离调用工作目录
  workspace.json       # 用户显式选择的工作区路径
  workspace/           # 未连接 CLI 工作区时的默认学习数据
```

每会话最多 1,000 条消息，单条输入最多 20,000 字符、回答最多 64,000 字符，会话文件最多 12,000,000 字节；达到保存限制时需处理错误或开启新会话。历史选取最多 24 条，目标与历史片段使用约 40,000 字符预算；当前输入、约束、摘要和受授权学习上下文另计，不会因此删除本地较早消息。草稿与最近会话标识使用该应用的 localStorage 保存。桌面不会自动迁移 CLI 的会话或学习进度。

## 验证

安装根目录与桌面两套依赖后，从根目录执行：

```bash
npm run verify
npm --prefix desktop run build
npm --prefix desktop run test:ui
```

`verify` 运行 lint、根目录和桌面类型检查、Vitest（包含 CLI 工作流）、集成测试、评估、mock smoke、敏感内容扫描与 diff 空白检查；它不包含 Electron UI 测试或安装包验证。`test:ui` 自动准备 Electron/SQLite 运行时并构建，在隔离数据与禁止真实请求的环境中运行原有和学习流程两套 UI 回归。

历史 [P10 桌面验证记录](docs/evidence/desktop-app.md) 的质量门通过 58 个测试文件、281 个测试，开发窗口和实际打包应用 UI 测试通过；已有 Keychain 配置的 DeepSeek 短请求成功。Pi 模型偏好和内附运行环境的验证不等于 Codex 登录完成，后者仍未通过真实调用验收。这些是已有验证记录，不代表每次阅读本文时重新运行过检查。

本轮完整命令、测试数量和实际 0.3 包验收见 [升级 Evidence](docs/evidence/agent-upgrade.md)。

## 文档

| 主题 | 文档 |
| --- | --- |
| 桌面安装、使用和打包 | [桌面版 README](desktop/README.md)、[桌面验收记录](docs/evidence/desktop-app.md) |
| 安装与首次使用 | [快速开始](docs/GETTING-STARTED.md) |
| 命令说明 | [CLI 参考](docs/CLI-REFERENCE.md) |
| Provider 与数据边界 | [配置](docs/CONFIGURATION.md) |
| 架构与安全模型 | [架构设计](docs/architecture.md)、[数据与质量契约](docs/data-and-quality-spec.md)、[安全说明](SECURITY.md) |
| 开发与验证 | [开发指南](docs/DEVELOPMENT.md)、[测试指南](docs/TESTING.md)、[故障排查](docs/TROUBLESHOOTING.md) |

运行时审查、修复证据和仍未对齐的能力见 [Agent 审查报告](docs/evidence/agent-runtime-audit.md)。

参与开发请阅读 [贡献指南](CONTRIBUTING.md)。

## 许可证

根包和桌面包均标记为 `UNLICENSED`，保留所有权利；使用与分发条件见 [LICENSE](LICENSE)。
