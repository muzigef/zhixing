<!-- generated-by: gsd-doc-writer -->
# 配置

本文对应桌面 `0.11.0` 的源码契约；最近核对日期为 2026-09-11。实际安装、账号连通与验收状态以[当前状态](current-status.md)为准。历史版本指南用于说明当时增量，不能覆盖本文的当前配置。

## 通用服务商与原生协议

当前采用[通用接入架构](provider-architecture.md)。目录提供模板，同协议的其他厂商可直接选择自定义；官方订阅通过独立受信任适配器扩展，不能仅凭模板存在认定可用。

设置 → 添加 API 连接 → 选择服务商模板，填写控制台给出的模型 ID，再填写 API Key。预设包括 OpenAI、Claude、Gemini、DeepSeek、Qwen、Kimi、GLM、MiniMax、豆包、混元；也可选择“自定义服务商”。模型 ID 留空等待用户选择，不自动跟随服务商的“最新”别名。

| 协议 | 根地址例子 | 应用追加的路径 | 用量与续接 |
| --- | --- | --- | --- |
| Chat Completions | `https://api.deepseek.com` | `/chat/completions` | 保留兼容参数、原始思考内容及 Gemini 工具签名 |
| Responses | `https://api.openai.com/v1` | `/responses` | `store:false`，回传加密 reasoning 与 `call_id`；应用维护完整上下文 |
| Messages | `https://api.anthropic.com/v1` | `/messages` | 原生 system/content blocks、签名与 tool_result；缓存输入纳入总输入计量 |

MiniMax 的 Messages 根地址为 `https://api.minimax.io/anthropic/v1`；中国站按官方控制台修改。Qwen 地址与地域/工作空间有关，模板不填猜测的地址。腾讯新连接使用 TokenHub。Root URL 不包含 `/messages`、`/responses` 或 `/chat/completions` 末段，也不能包含密钥、查询参数及用户密码。

订阅登录、普通 API Key、套餐 Key 不是同一凭证。阿里、智谱等 Coding 套餐不默认适用于知行的教学及批量团队；MiniMax Token Plan Key 与普通 API Key 分开建连接。Kimi Code 与 Moonshot 平台也分别管理。详见[十家官方调研](provider-integration-plan-20260910.md)。

CLI 共用同一个目录与协议工厂：

```bash
npm start -- 模型服务商
npm start -- 模型连接模板 anthropic
npm start -- 官方Agent状态
```

模板返回公开 JSON，填写地址/模型后交给 `模型连接添加 <JSON>`；Key 仍通过 `模型添加 api-key <连接 ID>` 的隐藏输入保存。既有 Chat Completions 连接 ID、密钥引用及对话不会重建。新增协议配置需要当前版本，旧版本不支持解析这些连接。

设置 → 官方 Agent 账号 → 检查官方 Agent：仅运行版本和帮助命令，不发送模型请求；检查能力成功不代表已经登录。

- **Codex / ChatGPT 订阅**：先在官方客户端运行 `codex login`。知行已验收本机 Codex **0.153.4**；其他版本先验证权限与空工具请求后再启用，不修改官方二进制。设置中的“Codex 程序与模型”可指定绝对路径与订阅实际支持的模型，默认模型为本次真实验证的 `gpt-6-astra`。程序留空时从常用 Homebrew 位置或 PATH 查找。CLI 使用 `模型切换 tutor native-codex --确认`；环境变量为 `ZHIXING_CODEX_EXECUTABLE`、`ZHIXING_CODEX_MODEL`。固定模型进入同模型团队；异模型团队默认成员为 DeepSeek、Kimi。
- **Claude Code**：已核对 2.1.267 的 `--restricted`、`--safe-mode` 等开关，设置中可指定程序；先运行 `claude auth login`。知行仅解析 `auth status --json` 的登录方式，不导入 token。当前模型由官方客户端选择，未固定，因此仅开放单 Agent。CLI 使用 `模型切换 tutor native-claude --确认`，程序变量为 `ZHIXING_CLAUDE_EXECUTABLE`。
- **Gemini CLI**：原生执行尚未完成；可配置 Google 官方兼容 API。不能将模板描述为订阅通道已经打通。

原生通道和 API 共用 AgentService 的教学、历史、授权上下文及回答检查。Codex 使用一次性目录、官方 permission profile、忽略用户扩展配置、空工具请求和非持久会话；不会执行本机或知行工具。API 成员仍可按授权调用只读 ToolHarness。官方订阅失败不会自动消费 API，进程退出也不证明远端请求未计费。

原生团队按任务数、时限和可见回答长度实施硬限制；CLI 内部推理 token 无法硬限，按实际返回用量核算，超过预算后停止新调用。未知用量保留预留。API 请求数与原生任务数分别显示并共享总调用上限。仅含原生预算的团队使用 v12；含自动成员资源策略的团队使用 v13。两者均保存升级前备份，旧应用不能覆盖新字段。

知行有 CLI 学习工作区和桌面对话两套偏好配置。CLI 默认使用 `mock`；桌面首次启动默认选择 `pi-codex`。两者可复用 Pi 的全局模型偏好及 macOS 上已有的知行 DeepSeek / Kimi Keychain 项，模型选择和聊天独立；学习资料可通过显式连接同一工作区共用。

## 运行时与环境变量

CLI 和源码开发要求 Node.js `24.8.x`，CLI 启动时会检查版本。已打包桌面应用内附 Electron 和 Pi 运行时，不要求用户另装 Node.js；当前已验证的平台范围见[桌面说明](../desktop/README.md)。

应用没有自动加载 `.env` 的实现，也没有通过环境变量配置 API Key 的入口。以下变量均为可选项，缺失它们不会单独导致启动失败。

| 变量 | 必填 | 默认值 | 作用与范围 |
| --- | --- | --- | --- |
| `ZHIXING_ROOT` | 否 | CLI 源码所在项目的父目录 | CLI 学习工作区根目录；相对值按启动进程的工作目录解析。桌面不使用它。注意 CLI 会在该目录下追加 `zhixing/`。 |
| `ZHIXING_ALLOW_LIVE_PROVIDER` | 否 | 未设置，允许真实 Provider 调用 | CLI 和桌面都识别；只有字符串 `0` 会禁止真实 Provider 请求。它不会配置账号、修改保存的路由，或自动选择 mock/demo。 |
| `ZHIXING_DEEPSEEK_MODEL` | 否 | `deepseek-v4-flash` | CLI 的 DeepSeek 模型名，在创建适配器时读取。桌面显式传入 `preferences.json` 中的 `deepseekModel`，因此桌面模型选择不受此变量覆盖。 |
| `ZHIXING_CODEX_EXECUTABLE` / `ZHIXING_CLAUDE_EXECUTABLE` | 否 | 常用 Homebrew 路径或 PATH 中的 `codex` / `claude` | 官方程序路径；桌面已保存的对应路径优先于启动环境。路径配置不能绕过运行时能力检查。 |
| `ZHIXING_GEMINI_EXECUTABLE` | 否 | 常用路径或 `gemini` | 通用目录的程序发现入口；当前只提供状态检查，不启用 Gemini 原生执行。 |
| `ZHIXING_CODEX_MODEL` | 否 | `gpt-6-astra` | 官方 Codex 模型；桌面已保存的 `nativeCodexModel` 优先。模型固定后才允许团队使用。 |
| `ZHIXING_CONTEXT_WINDOW_TOKENS` / `ZHIXING_OUTPUT_TOKENS` | 否 | `48000` / `16384` | 共享模型工厂读取的上下文窗口/输出预留；桌面显式预算优先。窗口 512–48000、预留 128–16384，预留必须小于窗口，还受适配器能力限制。 |
| `HTTP_PROXY` / `HTTPS_PROXY` / `ALL_PROXY` / `NO_PROXY`（以及原生通道的小写形式） | 否 | 继承启动环境 | 原生进程仅透传白名单代理变量；实际协议支持由所用运行时决定。API/Pi 的 Node 代理需其运行时支持，见桌面代理说明。 |
| `NODE_USE_ENV_PROXY` | 否 | 未设置 | 可用于支持该选项的 Node/Electron API/Pi 环境代理；官方原生进程不透传此变量。不要假定它配置系统代理。 |
| `PI_CODING_AGENT_DIR` | 否 | `~/.pi/agent` | CLI 和桌面所读取的 Pi 全局配置目录；知行仅解析其中的 `settings.json` 模型偏好。 |
| `ZHIXING_PI_TRANSPORT` | 否 | `sse` | 两端 Pi SDK 的传输策略，可设为 `auto` 做兼容性对照；无效值拒绝请求。不会修改 Pi 偏好、模型或思考强度，同样作用于 CLI Pi。 |
| `NO_COLOR` | 否 | 未设置 | CLI 中只要存在就关闭终端颜色，包括空字符串；不改变桌面主题。 |
| `TERM` | 否 | 继承终端环境 | CLI 在值为 `dumb` 或输出不是 TTY 时关闭颜色。 |
| `PATH` | 否 | 继承进程环境 | CLI 用它寻找 `codex`、macOS `security` 和可选 OCR 工具。桌面内附 Pi 的执行路径不依赖全局 `pi`。 |

环境变量作用于启动后的进程。从终端运行源码应用时可在命令前设置，例如：

```bash
ZHIXING_ALLOW_LIVE_PROVIDER=0 npm run repl
ZHIXING_ALLOW_LIVE_PROVIDER=0 npm run desktop
```

这些命令会禁用真实模型请求；要体验本地输出，还需在 CLI 选择 `mock` 或在桌面设置中选择“离线演示”。已经运行的应用不会因为另一个终端执行 `export` 而改变配置；Finder 启动的应用也不应假定继承当前交互式终端的变量。

## CLI 工作区与持久化设置

以下用 `<root>` 表示 `ZHIXING_ROOT` 解析后的目录。未设置变量时，当前仓库布局是 `<root>/zhixing/`：例如仓库位于 `/path/agent/zhixing`，则 `<root>` 为 `/path/agent`。将变量直接设为仓库目录会得到多一层的 `zhixing/zhixing/` 数据路径。改变此变量不会自动复制原工作区的主题计划、Skill、资料或数据库。

| 路径 | 内容与默认行为 |
| --- | --- |
| `<root>/zhixing/settings/model-routing.local.json` | `tutor`、`reviewer`、`lab` 的 Provider 路由；初始均为 `mock`，切换后保存。缺失或无法读取的路由文件保留默认值，不存在的 Provider 项被忽略。 |
| `<root>/zhixing/settings/current-topic.local.json` | `{"topicId":"agent-development"}` 形式的当前主题。优先级为有效的 `--topic` 参数、有效的已保存主题、`agent-development`。 |
| `<root>/zhixing/settings/topics.local.json` | 用户创建主题的 `topicId`、`title` 数组，由“创建主题”命令管理。 |
| `<root>/zhixing/data/sessions/<topicId>/response-style.json` | 当前主题的 `topicId`、`style`，默认风格为 `adaptive`。 |
| `<root>/zhixing/data/sessions/<topicId>/` | 主题学习状态、教学检查点及对话；不是桌面会话目录。 |
| `<root>/zhixing/db/zhixing.sqlite` | CLI 资料索引、记忆及工作流等 SQLite 数据。 |
| `<root>/zhixing/data/library/<topicId>/` | 当前主题导入的资料。 |
| `<root>/zhixing/data/audit/<topicId>/` | 当前主题的审计记录。 |
| `<root>/zhixing/inbox/<topicId>/` | 用户显式暂存、等待导入的资料。 |
| `<root>/learning-notes/topics/<topicId>/` | 学习笔记、计划/课程草案、`LEARNING_PROFILE.json` 和 `REMINDER.json`；默认位于仓库的同级目录。 |

路由文件不含密钥，示例：

```json
{
  "routes": {
    "tutor": "pi-codex",
    "reviewer": "mock",
    "lab": "mock"
  }
}
```

建议通过命令修改配置。在已打开的 REPL 中输入：

```text
模型状态
模型切换 tutor pi-codex --确认
模型切换 tutor deepseek-api --确认
模型切换 tutor kimi-api --确认
模型切换 tutor mock --确认
/style detailed
```

这些切换命令是不同选择的示例，按需要执行其中一个。内置 Provider 为 `mock`、`deepseek-api`、`kimi-api`、`codex-cli` 与 `pi-codex`，官方运行时目录另注册 `native-codex`、`native-claude`、`native-gemini`；注册不代表全部已实现。自定义连接使用 `api-<32 位哈希>`。保存路由不会自动安装 Provider 或验证登录。`/style` 支持 `concise`、`adaptive`（别名 `balanced`）、`detailed` 以及“简洁/适中/详细”；按主题保存，本轮明确的篇幅和格式要求优先。

学习画像包含 `goal`（2–240 字符）、`level`（1–80 字符）、`dailyMinutes`（15–480 整数）、`totalDays`（1–180 整数），没有自动填充的画像默认值。提醒配置包含 `time`（24 小时制 `HH:mm`）和 `enabled`；桌面运行或交互终端 REPL 打开时，由共享调度器每 15 秒检查；到点五分钟内按本地日期领取一次提醒，多主题合并。退出后不运行，错过不补发；系统可能静音通知。可用“提醒关闭”或桌面课程面板关闭。

## 桌面偏好与本地数据

桌面主进程明确设置数据目录为 Electron 的 `app.getPath("appData")/Zhixing`。macOS 通常为 `~/Library/Application Support/Zhixing`，Windows 通常为 `%APPDATA%\Zhixing`；以当前系统的应用数据目录为准。

| 路径（相对于桌面数据目录） | 用途 |
| --- | --- |
| `preferences.json` | Provider、回答风格、界面主题、推理档位、上下文预算、团队配置、语义模型及官方程序/模型偏好。 |
| `conversations/<UUID>.json` | 共享会话清单、尾部最多 250 条消息及状态；更早历史在同名 UUID 子目录中按哈希分段，完整会话最多 20,000 条/12,000,000 字节。普通会话 v8，团队按能力保存为 v9–v13，详见下文。 |
| `api-connections.json` / `api-<32 位哈希>.credential` | 自定义连接公开配置 / 对应系统加密密文；密文不进入备份。 |
| `deepseek.credential` | 新添加 API Key 的系统加密数据，不是 JSON 或明文配置。 |
| `kimi.credential` | 独立的 Kimi API Key 系统加密数据，保存规则与 DeepSeek 相同。 |
| `workspace.json` / `workspace/` | 显式连接的工作区路径 / 默认学习数据根。连接已有 CLI 根时不迁移用户数据。 |
| `runtime/` | Pi 子进程的工作目录；应用启动时复制专用 `AGENTS.md`，不会加载开发仓库的学习资料。 |

输入草稿及最后打开的会话还保存在本机桌面渲染器的 `localStorage`（`drafts`、`last-session`），不在 `preferences.json` 中。会话、偏好和凭据不会自动迁移到另一台设备，学习数据由显式选择的工作区共享，不执行后台复制。

首次使用、尚无偏好文件时的配置：

```json
{
  "provider": "pi-codex",
  "style": "adaptive",
  "theme": "system",
  "deepseekModel": "deepseek-v4-flash"
}
```

| 字段 | 可选值与限制 |
| --- | --- |
| `provider` | `pi-codex`、`deepseek-api`、`kimi-api`、`demo`，以及自定义 `api-<32 位哈希>`。另有 `native-claude`、`native-codex`、`native-gemini` 状态契约；Codex 仅上下文单 Agent 和团队已实现并通过本机真实订阅验证，Claude 单 Agent 已实现但真实订阅未验收，Gemini 原生执行尚未实现。桌面没有 `codex-cli` 选项。 |
| `style` | `concise`、`adaptive`、`detailed`；桌面是全局偏好，不按 CLI 主题分组。 |
| `theme` | `system`、`light`、`dark`。 |
| `deepseekModel` | 设置界面提供 `deepseek-v4-flash`、`deepseek-v4-pro`、实验性 `deepseek-v4-flash-vision-exp`（图片需此模型）；底层 schema 接受 1–128 字符、以字母/数字开头、其余为字母/数字/点/下划线/连字符的模型标识。格式有效不代表远端支持该模型。 |
| `reasoning` | 可省略；`auto`、`quick`、`balanced`、`deep`。省略时使用 balanced，auto 由共享策略选择实际档位。 |
| `contextBudget` | 可省略；`windowTokens` 与 `reserveOutputTokens`，必须满足上表范围，预留小于窗口。 |
| `collaboration` | 可省略，默认单 Agent；包含模式、最多两名成员、成员资源及整题预算，见文末。 |
| `semanticModel` | 可省略或为空；本机 Ollama 模型名，不自动下载。 |
| `nativeClaudeExecutable` / `nativeCodexExecutable` | 可选官方程序路径；使用设置界面选择/填写，执行前仍验证能力。 |
| `nativeCodexModel` | 可选固定模型 ID，1–128 字符，不接受 `auto`。 |

已有偏好文件优先于首次默认值。因此本机上次选择了 DeepSeek 时，重启会继续使用 DeepSeek，这不意味着应用的默认 Provider 已改为 DeepSeek。缺失字段使用 schema 默认值；损坏或字段值无效的文件会报 `settings_invalid`，不会静默清除用户文件。

在设置或输入框的模型菜单切换 Provider 后，下一条请求使用新选择；已开始的请求保持启动时的 Provider 和模型。Pi 回答失败时，可点击“切换到 DeepSeek 重试”，在同一会话重新提交原问题。此操作由用户触发，会保留失败消息及上下文；不会自动切换，也不会把失败内容算作完成。

## DeepSeek API 与凭据

CLI 使用 macOS Keychain，通过隐藏输入配置：

```bash
npm start -- 模型添加 api-key deepseek-api
npm start -- 模型切换 tutor deepseek-api --确认
```

逻辑引用为 `keychain:zhixing/deepseek-api`，Keychain account 为 `zhixing`，service 为该引用。CLI 当前没有 Windows/Linux 的 Keychain 替代实现。不要将 Key 放进命令参数、偏好 JSON、`.env`、仓库或日志。

桌面在“设置 → DeepSeek API”中输入并保存 Key，顺序为：

1. 如桌面目录已有 `deepseek.credential`，优先使用该文件，经主进程调用 Electron 异步 `safeStorage` 解密。
2. 文件不存在且处于 macOS 时，可复用 CLI 原有 Keychain 项；状态检查仅检查元数据，真正请求时再由主进程读取 Key。
3. 新保存的 Key 写入桌面独立加密文件，不覆盖旧 Keychain 项。系统加密不可用时拒绝保存；当前 Linux 明确不启用该加密入口，没有明文降级路径。

桌面 Key 要求去除首尾空白后长度为 8–4,096 字符且不含空白字符。已有加密文件解密失败时会报错，不会再偷偷使用旧 Keychain 项。设置页只显示“是否配置/来源”，不会回填 Key；“已配置”也不等于余额、Key 有效性或网络已验证。真实系统加密写入及模型连接的验证范围见[桌面验证记录](evidence/desktop-app.md)。

内置 DeepSeek 适配器的默认请求地址由代码定义为 `https://api.deepseek.com/v1/chat/completions`；该内置连接不提供 base URL 设置，需要其他端点时另建自定义连接。它使用 SSE 文本/工具协议；quick 关闭 thinking，balanced/deep 分别选择 low/high 推理强度。CLI 和桌面共用适配器；选定主题并授权学习上下文后，可调用相应受控工具。默认单次 DeepSeek 请求超时为 60 秒。

## Pi Codex 接入

Pi 选择规则定义在 `src/pi-client.ts`，每次请求重新解析，按字段合并以下两处设置，后者优先：

1. `<PI_CODING_AGENT_DIR>/settings.json`，未设目录时使用 `~/.pi/agent/settings.json`。
2. `<projectDir>/.pi/settings.json`。

CLI 的 `projectDir` 是知行源码仓库目录，不随 `ZHIXING_ROOT` 更改。**桌面的 `projectDir` 则为其数据目录下的 `runtime/`**，包括开发模式。因此只在开发仓库 `.pi/settings.json` 中设置模型，不会自动作用于桌面；CLI 与桌面通常共享第一层全局 Pi 设置。

知行只读取三个非敏感字段：

| 字段 | 要求或默认值 |
| --- | --- |
| `defaultProvider` | 必须为 `openai-codex`，否则 `pi_configuration_required`。 |
| `defaultModel` | 必须存在；1–128 字符，格式同上述模型标识规则；不猜测模型，也不从模型列表自动挑选。 |
| `defaultThinkingLevel` | 默认 `medium`；接受 `off`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`。远端是否接受仍由实际请求决定。 |

设置文件必须是 JSON 对象且不超过 256,000 字节；缺失文件可以由另一层补齐字段，非法 JSON 或无效字段会报配置错误。配置变更前已经开始的请求保持原选择。

CLI 与桌面均安装 Pi `0.85.0`，使用同一公共模型 SDK worker。CLI 使用 Node/tsx，桌面使用 Electron 自带运行时与编译后的 worker。应用声明的工具由 ToolHarness 执行，Pi 原生文件或 shell 工具不开放。正文走 stdin；子进程设置 `PI_TELEMETRY=0`、`PI_SKIP_VERSION_CHECK=1`、`PI_OFFLINE=1` 和 `ELECTRON_RUN_AS_NODE=1`。

模型发现的离线设置不禁止本次模型请求，禁止真实调用仍需 `ZHIXING_ALLOW_LIVE_PROVIDER=0`。两端校验模型身份、结束原因及进程退出码，均支持受控工具续答，单次上限 150 秒；取消会终止子进程。每轮使用独立进程，历史由共享 AgentService 管理。

0.4.1 桌面默认明确使用 SSE，避免短生命周期 WebSocket 的关闭等待。设置中的诊断按模型、思考强度和传输策略显示逐轮 SDK 准备、请求至首事件、请求至完成及完成后收尾；聊天另存 `modelTimings`。请求耗时包含认证、网络和远端处理，不能解释为纯模型推理时间。未知阶段不填 0。`auto` 仅用于对照或兼容性排查，不保证实际使用 WebSocket。

Pi 的认证和刷新由 Pi 处理，知行不读取认证文件。若提示登录失效，可在有系统 Pi 的开发环境运行 `./scripts/pi-safe.sh`，在 Pi 中执行 `/login` 并选择 OpenAI Codex，完成后重试。桌面没有内置登录向导。“已读取 Pi 模型配置”仅代表上述字段有效，不代表登录已经成功。

CLI 保留 `codex-cli` 作为旧路由名称，但现已映射到独立的官方 Codex Agent 执行边界。它与 `native-codex` 一样使用官方订阅执行器，不能通过旧 ModelClient 绕过隔离检查；原路由和历史记录保留。新配置建议选择 `native-codex`。桌面没有 `codex-cli` 选项。

## 联网限制、本地演示与外发范围

需要区分三种行为：

- `ZHIXING_ALLOW_LIVE_PROVIDER=0` 禁止真实 Provider 请求与桌面版本网络检查；不会自动切换 Provider。本地 mock 路由的受控材料调用仍可运行，E40 已用明确禁外发环境覆盖该边界。
- CLI `mock` 只用于本地学习流程/协议演示；自然多轮辅导会提示切换真实 Provider。桌面 `demo` 输出固定的离线演示内容，用于体验界面，也不是真实模型。
- Pi 的 `--offline` 与前两者不同，仍允许本次模型请求。

CLI 自然问答、教学和学习助手调用禁用 fallback；桌面也没有自动 fallback。共享 `ProviderRuntime` 对少数允许 fallback 的 CLI 调用仍保留受限机制：只有尚未输出任何事件、未取消且错误属于可回退类别时，才可能调用 mock。一旦输出文本或工具事件，就不会拼接 mock 内容，也不会修改保存的角色路由。

选择真实模型不会自动授权读取学习数据。两端都发送当前请求、持久目标/约束、有界历史与可选摘要；画像、记忆、教学检查点和资料须经会话授权。CLI 用 `/permissions --允许外发` 或问题后的 `--允许外发` 开启学习上下文，延续到本会话；用 `/permissions --撤回全部` 撤回。项目和外部工具独立授权。桌面对应会话中的访问开关。授权前不读取学习卡、画像、显式记忆和检索正文。

两端历史最多 24 条，目标和历史片段约 40,000 字符预算，其他提示另计；授权后最多加入 8 条资料片段，每条 2,000 字符。撤权后停止新注入，但不自动删除以前的会话文本。输入上限 20,000 字符、回答上限 64,000 字符，总时限 180 秒；CLI 当前命令解析另限制单次输入 8,000 字符。全部记忆与长对话规则见 [统一设计](agent-memory.md)。

## 本地 OCR 与同步

- OCR：CLI 需要 `tesseract` 和 `pdftoppm` 在 `PATH` 中；本地扫描 PDF 转图片和识别不发送文件到模型。工具不可用时资料保留为 `ocr_required`。桌面原生导入使用同一受控 importer；OCR 工具仍需在本机可用。
- 同步：CLI 的 `启动同步服务 [port]` 仅监听 `127.0.0.1`，省略端口或传 `0` 时由系统分配端口；提供 `GET /topics/<topicId>/progress` 和 `GET /topics/<topicId>/events`（SSE）。CLI 的受控 `run()` 成功返回后会调用 `publish()`，推送包含 `topicId`、`command`、`at` 的 `progress` 变更通知；完整进度需再次 GET。它是本机接口，没有云账号、跨设备复制或桌面同步客户端。
- 同步路由与核心 topicId schema 一致，允许 `3dgs` 等数字开头主题；未注册主题仍拒绝。
- Docker/Colima 不是应用的运行依赖。

## 测试覆盖变量与环境隔离

项目没有 `.env.development`、`.env.production` 等自动分环境机制。真实使用通过启动环境与上述持久化设置配置；自动检查使用隔离目录。以下变量仅用于测试/开发工具，不应作为普通用户设置项：

| 变量 | 使用位置与行为 |
| --- | --- |
| `ZHIXING_DESKTOP_TEST_DATA` | 覆盖桌面 `userData` 为临时目录；设置后默认禁止复用真实 macOS Keychain 项。 |
| `ZHIXING_DESKTOP_LIVE_CHECK=1` | 在隔离桌面数据目录下允许检查/使用旧 macOS Keychain 项；它本身不解除 `ZHIXING_ALLOW_LIVE_PROVIDER=0`。 |
| `ZHIXING_DESKTOP_EXECUTABLE` | `desktop/scripts/smoke.mjs` 指定要验证的 Electron/打包应用可执行文件。 |
| `ZHIXING_DESKTOP_DEV` | 仅影响 UI smoke：与指定可执行文件并用且值非空时，仍将源码桌面目录传为启动参数。 |
| `ZHIXING_DESKTOP_NATIVE_CIPHER=1` | UI smoke 额外调用真实系统加密处理合成字符串；可能触发 OS 授权，不读取已有 API Key。普通 UI 夹具不等于此项通过。 |
| `ZHIXING_PI_LATENCY_TRACE` | 延迟诊断 preload 的输出文件路径，仅诊断脚本使用。 |
| `CI` | 非空时 Vitest 将 `maxWorkers` 设为 1；不是运行时模型配置。 |

打包变量 `ZHIXING_LOCAL_SIGNING_IDENTITY`、`ZHIXING_ALLOW_ADHOC`、`ZHIXING_SIGN_MACOS` 见[签名指南](macos-local-signing.md)。正式签名/公证还使用 `CSC_LINK`、`CSC_KEY_PASSWORD`、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`；仅在构建环境配置，不放入用户偏好或公开文档。`CSC_IDENTITY_AUTO_DISCOVERY` 由构建脚本固定关闭。CI 的 `ZHIXING_DESKTOP_INSTALLED_EXECUTABLE` 由 Windows 安装验收脚本产生，普通用户无需设置。

桌面 UI smoke 会自行创建临时 Pi 偏好和数据目录，并禁用真实 Provider。`desktop/scripts/check-deepseek.mjs` 默认只检查已有 API 配置状态；只有显式传入 `--live` 才允许其发起短问题请求。桌面渲染代码构建时固定 `NODE_ENV` 为 `production`，它不控制 Provider 选择。检查命令及验证边界见[测试文档](TESTING.md)。

配置依据：[CLI 入口](../src/cli.ts)、[路径策略](../src/paths.ts)、[Pi 适配器](../src/pi-client.ts)、[DeepSeek 适配器](../src/deepseek-client.ts)、[桌面 schema](../desktop/core/contracts.ts)、[桌面主进程](../desktop/electron/main.ts)、[桌面凭据存储](../desktop/core/secrets.ts)。

桌面任务队列、目标摘要、证据文件、运行测试与分模型诊断的限制见 [0.3 指南](agent-upgrade.md)。

## 思考档位与语义检索

`preferences.json` 新增可选 `reasoning`（auto/quick/balanced/deep）与 `semanticModel`（本机 Ollama 已安装模型名）。未设置 reasoning 时发送使用 balanced；语义模型留空时使用关键词/同义词。会话另存 `executionAllowed`，仅由本次/本会话选择授予；分支、备份恢复清除授权。Pi 的两个入口均使用公共 SDK 模型接口。备份范围、可选发布签名配置见 [0.4 指南](agent-0.4.md)。

## 工具与实践环境

`reasoning=auto` 根据当前请求和执行方式选择实际档位，消息同时保存自动选择和实际档位；明确指定 quick/balanced/deep 不会被改写。Pi 传输的 `auto` 与思考档位的 `auto` 是两个不同选项，默认传输仍为 SSE。

上下文预算由共享 Runtime 控制，内置默认估算窗口 48,000 token、输出预留 16,384；API/Pi 模型视图另有 128,000 字符上限，官方 AgentExecutor 视图为 80,000。没有自动提高配额或精确计费承诺。普通任务最多 6 轮；连接项目并授权项目工具后，工具定义包含 `project_` 工具时最多 12 轮；团队另外受整题限制。

MCP 在主题面板中显式配置本地可执行程序、工具白名单、风险与信任确认，默认关闭，不通过 `.env` 自动注入密钥。实际协议和配置例子见 [MCP 指南](mcp-tools.md)。项目通过原生目录选择器导入副本或创建，模型不能选择用户目录；Git 需要本机可用。代码执行支持 macOS 系统沙箱及 Windows AppContainer helper，执行前预检和实际隔离结果缺一不可；Linux 不开放无隔离执行。见 [项目指南](practice-projects.md)。

当前读取 v1–v13 会话，读取本身不改写；普通会话保存为 v8，团队随成员/审查/任务图/原生预算/自动成员策略升级到 v9/v10/v11/v12/v13。首次升级保存前保留原版本备份，已保存的较高版本不降级。全量恢复清除 MCP 启用状态、项目选择和会话授权。SQLite 版本标记为 6，旧应用拒绝不兼容数据；不要手改版本号。

## 会话权限、预算与版本

学习资料、当前实践项目、外部 MCP 分别授权；项目权限绑定选中项目 ID，外部权限绑定配置修订。开启学习写入只覆盖学习产物和实验，不自动批准项目/MCP。操作卡可记住限定操作；撤回、换项目/配置、分支与备份恢复均限制旧授权，见 [会话权限](session-permissions.md)。

设置 `contextBudget` 可保存 `{ "windowTokens": 24000, "reserveOutputTokens": 4096 }`；省略使用适配器默认值，内置模型通常为 48,000 / 16,384，自定义连接另受自身默认 4,096 输出上限约束。可配置输出上限传给支持它的 API/Pi；官方运行时只按实际用量核算，不能硬限内部推理。报告输入量只用于保守校准估算，不提高预算。PNG/JPEG 输入仅在已声明支持视觉的模型开放，官方原生执行器当前拒绝图片，见[图片输入](image-input.md)与[模型上下文](model-context.md)。

MCP 五分钟目录缓存绑定配置和 schema，普通问答不启动外部进程；语义检索失效会提示关键词降级。Skill 面板显示版本/哈希及旧缓存状态，不静默把旧缓存当更新成功。构建 manifest 和试验条件见 [0.6 指南](agent-0.6.md)。

## 本地访问与隔离

MCP 配置可指定 `isolation: "restricted"` 和 `readPaths`（最多八条绝对路径），只在具备系统沙箱的 macOS 上启用；读取目录代表允许其全部子目录，写入只限临时工作目录，网络禁止。不支持的平台拒绝连接。省略 isolation 兼容为 `trusted`，服务以账户权限运行；工具 read 标签并不能阻止其副作用。隔离模式/路径改动同样使旧工具授权失效，见 [MCP 指南](mcp-tools.md)。

同步服务启动后显示临时访问码；调用时携带 `Authorization: Bearer <临时访问码>` 请求头，不放 URL、不持久化。重启后旧访问码失效，网页请求被拒绝。提醒每日领取标记保存在主题笔记的 `reminder-delivery/`，属于完整备份内容；已领取但通知前崩溃可能漏发。

共享图片输入、模型能力及历史预算见[图片输入](image-input.md)；历史平台验收见[0.9 记录](evidence/completion-0.9.md)，当前验收和外部条件见[当前状态](current-status.md)。

## Kimi API

桌面：设置 → Kimi API → 填写 Key → 保存 → 测试连接。国内开放平台地址为 <https://platform.kimi.com/>；使用开放平台 API Key，无需聊天会员。K3 需账户充值开通，具体要求见[官方指南](https://platform.kimi.com/docs/guide/kimi-k3-quickstart)。

CLI 同样经过共享模型工厂和 AgentService：

```bash
npm start -- 模型添加 api-key kimi-api
npm start -- 模型切换 tutor kimi-api --确认
```

第一条命令通过隐藏输入读取 Key，不能把 Key 追加到命令行。逻辑引用 `keychain:zhixing/kimi-api`；桌面密文 `kimi.credential`。桌面与 CLI 的会话/配置位置仍独立；macOS 桌面可读取 CLI 的 Kimi Keychain 项，桌面独立密文不会反向同步。

当前支持固定模型 `kimi-k3` 和国内接口 `https://api.moonshot.cn/v1/chat/completions`；不能将国际平台的 Key 假定为国内接口可用。Kimi 不读取 `ZHIXING_DEEPSEEK_MODEL`。快速/均衡/深入思考映射为 `low`/`high`/`max`，全部开启思考；工具续接保留本轮原生 assistant 状态，只显示最终回答文本。

“测试连接”也适用于 DeepSeek：不带历史、资料或工具，用快速档发送合成问题，输出预留 2,048 token、最长 60 秒；结果只返回成功与耗时，不返回密钥或推理内容，不写入聊天。账户余额、权限和限流错误会显示对应提示。当前工程和真实连通验收分开记录在 [Kimi Evidence](evidence/kimi-api-20260909.md)。

## 自定义 API 连接（0.9.2）

桌面打开 **设置 → 自定义 API 连接 → 添加 API 连接**，选择协议/模板，填写连接名称、API 根地址、模型 ID 和 Key，保存后选择该连接并点击“测试自定义连接”。支持 Chat Completions、Responses、Messages 三类协议及各自的认证头，同协议兼容厂商无需修改代码。同一家服务的多个模型也可分别配置。内置 Pi / DeepSeek / Kimi 继续可用，已有密钥不用迁移。

- 根地址形如 `https://api.example.com/v1`，程序按协议追加 `/chat/completions`、`/responses` 或 `/messages`。不要粘贴完整聊天端点、查询参数、用户名或密钥；要求 HTTPS，本机 `localhost` / `127.0.0.1` / `::1` 可用 HTTP。携带密钥的请求不跟随重定向。
- 模型 ID 必须来自服务商文档或控制台。连接名可自由修改。界面不推测账户能用哪些模型，也不以保存成功代替真实连通。
- 默认开启工具调用，关闭图片，不发送额外思考参数；窗口 48,000、最大输出 4,096 Token。请按服务文档设置：不支持工具则关闭工具，不支持视觉则关闭图片。全局预算与连接上限取较小值，保留相同的上下文裁剪策略。
- 高级选项可选择 `max_tokens` / `max_completion_tokens`，关闭不兼容的流式用量字段，并选择 OpenAI、DeepSeek、Kimi 思考参数。OpenAI 快速/均衡/深入映射 low/medium/high；DeepSeek 沿用快速关闭、均衡 low、深入 high；Kimi 为 low/high/max。
- 新增连接已支持 Chat Completions、Responses 与 Messages 三种协议；Messages 使用其原生 API Key 请求头。不支持任意自定义鉴权协议。同协议服务商只需配置，新协议仍需适配器开发。协议依据为 [OpenAI Chat Completions 官方参考](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。

最多保存 20 个连接。主进程将公开定义写入桌面数据目录 `api-connections.json`，每个 Key 使用系统加密单独保存在 `api-<32 位哈希>.credential`；Key 不回填到输入框。连接身份由协议、地址、模型及兼容能力共同决定，不受名称改变影响。更换地址、模型或能力时应添加新连接并配置 Key，避免旧任务被重新指向不同端点。管理已有连接时 Key 留空表示保留，填写表示替换。

移除连接只移除公开定义，保留对话和密文；不会替用户选择另一家模型。原连接的排队/恢复请求会明确失败，用户选择模型后可重新发起。完整备份包含公开连接定义并排除密文；恢复时合并缺失定义、保留本机同身份的现有名称，不自动切换模型。换电脑恢复后应重新输入 Key。

CLI 使用同一连接定义、适配器工厂和 AgentService，公开配置保存在工作区 `zhixing/settings/api-connections.local.json`，密钥仍由 macOS Keychain 保存。与桌面用户数据目录独立，不自动互相复制凭据：

```bash
npm start -- '模型连接添加 {"name":"我的模型","baseUrl":"https://api.example.com/v1","model":"vendor/model-id"}'
npm start -- 模型连接列表
```

第一条返回实际连接 ID。随后执行 `模型添加 api-key <连接 ID>`，在隐藏输入中填写 Key，再执行 `模型切换 tutor <连接 ID> --确认`。JSON 只接受公开字段，不能放 API Key。CLI 的聊天、教学模式和桌面均通过共享长对话及工具策略处理请求。


## 团队预算与自动思考档位（2026-09-11）

“团队配置”可分别设置整题输出预算、成员思考档位及成员输出上限。默认整题仍为 16384；成员输出默认“自动分配”。声明推理与正文共享额度的 DeepSeek/Kimi 协议连接，会按可用额度选择不高于主 Agent 的自动档位：快速建议 4096、均衡建议 8192、深入建议 16384 token。分工、审查和最终回答先获得预留；两名自动成员在默认预算下采用快速档。

完整公开配置由 `src/team-contracts.ts` 校验；界面只提供其中适合直接调整的选项，CLI 可用 `/team config <JSON>` 保存完整定义：

| 字段 | 默认值 | 范围或含义 |
| --- | --- | --- |
| `mode` | `single` | `single` / `same-model-team` / `mixed-model-team` |
| `members` | 两名必需核查成员 | 1–2 名；角色为 reasoning-checker/material-checker/practice-reviewer，可指定 provider、reasoning、timeoutMs、maxOutputTokens |
| `shareContext` | `false` | 是否向成员分享已授权上下文；不新增主题/项目/MCP 授权 |
| `maxConcurrency` | `2` | 1–2 |
| `maxModelTurns` / `maxToolCalls` | `12` / `24` | 总调用 4–24 / 工具调用 1–48；原生任务也计入总调用门 |
| `maxInputTokens` | `192000` | 8000–1000000，累计输入规划/核算上限 |
| `maxOutputTokens` | `16384` | 2048–48000，整题共用，不是每名成员各有该额度 |
| `memberTimeoutMs` / `timeoutMs` | `180000` / `240000` | 成员 5000–180000 ms / 整题 30000–300000 ms；适配器较短超时仍有效 |

这些数值是知行的调度建议，不是厂商保证的最低值。DeepSeek 快速关闭额外思考；Kimi K3 快速使用 low，仍会推理。提高整题预算可能提高自动档位及实际费用；显式成员档位优先，手动输出值仍受整题剩余额度与适配器上限限制。任务卡显示实际采用的档位、单次上限及预算不足提示。主 Agent 档位不自动改变。

只有新建任务使用新自动策略；恢复任务保留原绑定和预算。成员策略进入 v13 会话，旧程序不能降级覆盖。未知模型能力与官方 Codex 通道保持原有档位策略。依据、复现和真实数据见[预算优化验收](evidence/team-resource-budget-20260911.md)。
