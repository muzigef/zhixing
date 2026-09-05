<!-- generated-by: gsd-doc-writer -->
# 配置

知行有 CLI 学习工作区和独立桌面对话两套配置。CLI 默认使用 `mock`；桌面首次启动默认选择 `pi-codex`。两者可复用 Pi 的全局模型偏好及 macOS 上已有的知行 DeepSeek Keychain 项，但不会自动同步模型选择、会话或学习资料。

## 运行时与环境变量

CLI 和源码开发要求 Node.js `24.8.x`，CLI 启动时会检查版本。已打包桌面应用内附 Electron 和 Pi 运行时，不要求用户另装 Node.js；当前已验证的平台范围见[桌面说明](../desktop/README.md)。

应用没有自动加载 `.env` 的实现，也没有通过环境变量配置 API Key 的入口。以下变量均为可选项，缺失它们不会单独导致启动失败。

| 变量 | 必填 | 默认值 | 作用与范围 |
| --- | --- | --- | --- |
| `ZHIXING_ROOT` | 否 | CLI 源码所在项目的父目录 | CLI 学习工作区根目录；相对值按启动进程的工作目录解析。桌面不使用它。注意 CLI 会在该目录下追加 `zhixing/`。 |
| `ZHIXING_ALLOW_LIVE_PROVIDER` | 否 | 未设置，允许真实 Provider 调用 | CLI 和桌面都识别；只有字符串 `0` 会禁止真实 Provider 请求。它不会配置账号、修改保存的路由，或自动选择 mock/demo。 |
| `ZHIXING_DEEPSEEK_MODEL` | 否 | `deepseek-v4-flash` | CLI 的 DeepSeek 模型名，在创建适配器时读取。桌面显式传入 `preferences.json` 中的 `deepseekModel`，因此桌面模型选择不受此变量覆盖。 |
| `PI_CODING_AGENT_DIR` | 否 | `~/.pi/agent` | CLI 和桌面所读取的 Pi 全局配置目录；知行仅解析其中的 `settings.json` 模型偏好。 |
| `NO_COLOR` | 否 | 未设置 | CLI 中只要存在就关闭终端颜色，包括空字符串；不改变桌面主题。 |
| `TERM` | 否 | 继承终端环境 | CLI 在值为 `dumb` 或输出不是 TTY 时关闭颜色。 |
| `PATH` | 否 | 继承进程环境 | CLI 用它寻找 `pi`、`codex`、macOS `security` 和可选 OCR 工具。桌面内附 Pi 的执行路径不依赖全局 `pi`。 |

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
模型切换 tutor mock --确认
/style detailed
```

三个切换命令是不同选择的示例，按需要执行其中一个。内置 Provider 为 `mock`、`deepseek-api`、`codex-cli` 与 `pi-codex`。保存路由不会自动安装 Provider 或验证登录。`/style` 支持 `concise`、`adaptive`（别名 `balanced`）、`detailed` 以及“简洁/适中/详细”；按主题保存，本轮明确的篇幅和格式要求优先。

学习画像包含 `goal`（2–240 字符）、`level`（1–80 字符）、`dailyMinutes`（15–480 整数）、`totalDays`（1–180 整数），没有自动填充的画像默认值。提醒配置包含 `time`（24 小时制 `HH:mm`）和 `enabled`；当前只保存提醒计划，不启动后台调度或系统通知。

## 桌面偏好与本地数据

桌面主进程明确设置数据目录为 Electron 的 `app.getPath("appData")/Zhixing`。macOS 通常为 `~/Library/Application Support/Zhixing`，Windows 通常为 `%APPDATA%\Zhixing`；以当前系统的应用数据目录为准。

| 路径（相对于桌面数据目录） | 用途 |
| --- | --- |
| `preferences.json` | Provider、回答风格、主题及 DeepSeek 模型。 |
| `conversations/<UUID>.json` | 每个会话的完整消息和状态，最多 1,000 条消息；达到上限后需新建会话。 |
| `deepseek.credential` | 新添加 API Key 的系统加密数据，不是 JSON 或明文配置。 |
| `runtime/` | Pi 子进程的工作目录；应用启动时复制专用 `AGENTS.md`，不会加载开发仓库的学习资料。 |

输入草稿及最后打开的会话还保存在本机桌面渲染器的 `localStorage`（`drafts`、`last-session`），不在 `preferences.json` 中。会话、偏好和凭据不会自动迁移到另一台设备，也不与 CLI 数据库同步。

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
| `provider` | `pi-codex`、`deepseek-api`、`demo`；桌面没有 `codex-cli` 选项。 |
| `style` | `concise`、`adaptive`、`detailed`；桌面是全局偏好，不按 CLI 主题分组。 |
| `theme` | `system`、`light`、`dark`。 |
| `deepseekModel` | 设置界面提供 `deepseek-v4-flash`、`deepseek-v4-pro`；底层 schema 接受 1–128 字符、以字母/数字开头、其余为字母/数字/点/下划线/连字符的模型标识。格式有效不代表远端支持该模型。 |

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

DeepSeek 适配器的默认请求地址由代码定义为 `https://api.deepseek.com/v1/chat/completions`，目前没有用户可配置的 base URL 设置。它使用 SSE 文本/工具协议并显式发送 `thinking: {"type":"disabled"}`。CLI 和桌面共用适配器；桌面对话只消费文本，不执行工具调用。默认单次 DeepSeek 请求超时为 60 秒。

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

CLI 通过 `scripts/pi-safe.sh` 启动系统 `pi`。桌面内附 Pi `0.80.7`，使用 Electron 自带运行时和等价的无 shell 启动器，保留工具守卫和空工具列表。两者传入 `--print --mode json --no-session --offline --no-tools --tools ''`，并关闭技能、模板与主题加载。请求正文走 stdin，不进入 argv，也不被当作 `@file` 参数。Pi 子进程会设置 `PI_TELEMETRY=0`、`PI_SKIP_VERSION_CHECK=1`、`PI_OFFLINE=1`；桌面启动器另设置 `ELECTRON_RUN_AS_NODE=1`，这些是内部启动参数，不是应用的用户偏好。

Pi 的 `--offline` 用于禁止启动时的更新等网络活动，**不禁止本次模型请求**；禁止真实调用仍需 `ZHIXING_ALLOW_LIVE_PROVIDER=0`。适配器输出文本增量、忽略推理流和累计快照，并校验模型身份、结束原因及进程退出码。单次上限 150 秒；取消会终止子进程。它不提供知行的多轮工具续写，也不复用 Pi RPC 常驻进程，历史由知行自己的会话 Store 保存。

Pi 的认证和刷新由 Pi 处理，知行不读取认证文件。若提示登录失效，可在有系统 Pi 的开发环境运行 `./scripts/pi-safe.sh`，在 Pi 中执行 `/login` 并选择 OpenAI Codex，完成后重试。桌面没有内置登录向导。“已读取 Pi 模型配置”仅代表上述字段有效，不代表登录已经成功。

CLI 另有 `codex-cli`，复用已安装、已登录的官方 Codex CLI，调用 `codex exec` 的只读临时会话，并传入 `--ignore-user-config`，不通过 Pi 选择模型或复用 Pi 会话。CLI 实际为该适配器配置 150 秒超时；桌面未暴露此 Provider。

## 联网限制、本地演示与外发范围

需要区分三种行为：

- `ZHIXING_ALLOW_LIVE_PROVIDER=0` 是真实 Provider 请求的拒绝开关，产生 `live_provider_disabled`；部分 CLI 调用会先在外发授权检查处被拒绝。该检查按 `containsUserMaterials` 与 `confirmed` 判断，不区分实际路由，因此某些带材料的调用（如“学习建议”）即使路由为 mock 也可能报 `external_content_confirmation_required`。它不保证所有命令仍能产生本地答案。
- CLI `mock` 只用于本地学习流程/协议演示；自然多轮辅导会提示切换真实 Provider。桌面 `demo` 输出固定的离线演示内容，用于体验界面，也不是真实模型。
- Pi 的 `--offline` 与前两者不同，仍允许本次模型请求。

CLI 自然问答、教学和学习助手调用禁用 fallback；桌面也没有自动 fallback。共享 `ProviderRuntime` 对少数允许 fallback 的 CLI 调用仍保留受限机制：只有尚未输出任何事件、未取消且错误属于可回退类别时，才可能调用 mock。一旦输出文本或工具事件，就不会拼接 mock 内容，也不会修改保存的角色路由。

选择真实模型后，CLI 会发送当前主题的受限上下文：资料问答包括检索证据，学习建议包括学习画像与资料名称，教学/答疑/练习包括当天学习卡、受限画像、相关记忆及必要对话。学习助手可查询进度和资料目录，正文检索额外要求本次命令的 `--允许外发`，不会继承上一轮标志。模型生成的动作草案仍须通过 schema 校验及 CLI 授权后执行；包含导入、删除、恢复或模型切换的草案需强确认。用户直接输入“导入资料”已是显式导入操作，不另要求 `--确认`；删除、恢复和模型切换仍要求该标志。

桌面只发送当前请求与最近最多 24 条、累计最多 48,000 字符的历史消息，不导入 CLI 学习资料。桌面单次输入上限为 20,000 字符，回答上限为 64,000 字符，总生成时限为 180 秒；Provider 自身的较短超时仍生效。这些限制目前由代码固定，没有用户可调配额或超时设置。

## 本地 OCR 与同步

- OCR：CLI 需要 `tesseract` 和 `pdftoppm` 在 `PATH` 中；本地扫描 PDF 转图片和识别不发送文件到模型。工具不可用时资料保留为 `ocr_required`。桌面当前没有资料导入/OCR 入口。
- 同步：CLI 的 `启动同步服务 [port]` 仅监听 `127.0.0.1`，省略端口或传 `0` 时由系统分配端口；提供 `GET /topics/<topicId>/progress` 和 `GET /topics/<topicId>/events`（SSE）。CLI 的受控 `run()` 成功返回后会调用 `publish()`，推送包含 `topicId`、`command`、`at` 的 `progress` 变更通知；完整进度需再次 GET。它是本机接口，没有云账号、跨设备复制或桌面同步客户端。
- 同步路由目前只接受字母开头的 topic ID，核心 schema 则允许数字开头；因此 `3dgs` 等有效学习主题的 HTTP/SSE URL 仍返回 404，需后续统一契约。
- Docker/Colima 不是应用的运行依赖。

## 测试覆盖变量与环境隔离

项目没有 `.env.development`、`.env.production` 等自动分环境机制。真实使用通过启动环境与上述持久化设置配置；自动检查使用隔离目录。以下变量仅用于测试/开发工具，不应作为普通用户设置项：

| 变量 | 使用位置与行为 |
| --- | --- |
| `ZHIXING_DESKTOP_TEST_DATA` | 覆盖桌面 `userData` 为临时目录；设置后默认禁止复用真实 macOS Keychain 项。 |
| `ZHIXING_DESKTOP_LIVE_CHECK=1` | 在隔离桌面数据目录下允许检查/使用旧 macOS Keychain 项；它本身不解除 `ZHIXING_ALLOW_LIVE_PROVIDER=0`。 |
| `ZHIXING_DESKTOP_EXECUTABLE` | `desktop/scripts/smoke.mjs` 指定要验证的 Electron/打包应用可执行文件。 |
| `ZHIXING_DESKTOP_DEV` | 仅影响 UI smoke：与指定可执行文件并用且值非空时，仍将源码桌面目录传为启动参数。 |

桌面 UI smoke 会自行创建临时 Pi 偏好和数据目录，并禁用真实 Provider。`desktop/scripts/check-deepseek.mjs` 默认只检查已有 API 配置状态；只有显式传入 `--live` 才允许其发起短问题请求。桌面渲染代码构建时固定 `NODE_ENV` 为 `production`，它不控制 Provider 选择。检查命令及验证边界见[测试文档](TESTING.md)。

配置依据：[CLI 入口](../src/cli.ts)、[路径策略](../src/paths.ts)、[Pi 适配器](../src/pi-client.ts)、[DeepSeek 适配器](../src/deepseek-client.ts)、[桌面 schema](../desktop/core/contracts.ts)、[桌面主进程](../desktop/electron/main.ts)、[桌面凭据存储](../desktop/core/secrets.ts)。
