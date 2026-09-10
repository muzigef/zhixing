<!-- generated-by: gsd-doc-writer -->
# 知行桌面版

0.7 将桌面和 CLI 的记忆、教学状态、历史与摘要策略收敛到同一执行链，详见 [统一记忆设计](../docs/agent-memory.md)与[本轮验证](../docs/evidence/unified-agent.md)。

独立权限、项目快照/Python、任务核对、Skill 版本和完整产品效果验证的基础能力见 [0.6 指南](../docs/agent-0.6.md)。当前 0.9 长历史与教学状态见[统一记忆设计](../docs/agent-memory.md)，交付验证见[架构修复记录](../docs/evidence/architecture-remediation.md)。

知行项目中的独立桌面对话包 `zhixing-desktop`，当前版本 `0.11.0`。提供连续学习对话、Pi Codex / DeepSeek / Kimi 切换和本地会话管理；新增课程/资料/证据、排队/纠正、持久目标与耗时统计，见 [0.4 使用指南](../docs/agent-0.4.md)。完整项目介绍见 [根 README](../README.md)。

本轮新增能力与数据兼容说明见 [0.5 指南](../docs/agent-0.5.md)：上下文预算、按需工具、自动思考档位、回答质量诊断、学习观察、MCP 和独立实践项目；保留既有审批、分支、技能及完整备份。

0.11 增加独立核查报告、分歧审查、一次定向复核及成员档位配置；32 个新题与解释复核完成，未证明团队更优。后续内部格式和图片边界补修后 723 项测试、实际目录包七组隔离 UI 通过；最新包原生加密仍等待系统授权，旧题回归与安装待完成。当前安装仍是 0.10.0。见[本轮记录](../docs/evidence/team-quality-optimization-20260910.md)。

0.10 支持默认单 Agent、同模型团队和异模型团队。团队配置复用已有 Pi/API 连接，成员只读，可查看状态和停止，详见[三模式指南](../docs/agent-teams.md)。[96 个真实留出任务](../docs/evidence/team-quality-comparison-20260909.md)及逐条解释复核已完成：普通 Pi 完整且正确 16/16，同模型团队 12/16，混合团队 8/16，未证明团队质量更高；已验证本机授权和显式代理通路。0.10.0 已安装到本机，旧包保留备份，见[安装记录](../docs/evidence/agent-teams-installation.json)。

## 安装和使用

当前已有验收记录的是 **macOS Apple Silicon、macOS 13.0 及以上**的本地预览版。已有构建产物时：

1. 打开本目录下的 `release/mac-arm64/知行.app`；本轮 0.11.0 已验证此目录包，未重新制作 DMG。
2. 将「知行」拖入 Applications，从启动台或 Finder 打开。
3. 在设置中选择模型方式，再输入问题；没有真实模型配置时可选「离线演示」。

`release/` 被 Git 忽略，**新克隆的仓库不包含安装包**。需要从源码运行或生成安装包时，按后文操作。现有构建没有 Apple Developer ID 签名、公证；设置支持主动检查公开版本并打开发布说明，更新由用户安装；已有 Windows NSIS 构建与 release 流水线，macOS ARM64 与 Intel x64 已通过远端构建和实际包 UI；Windows 原生隔离、实际 NSIS 安装及安装后五组 UI 均已通过。当前产物及已验证范围见 [0.9 验收记录](../docs/evidence/completion-0.9.md)，早期平台要求见 [桌面验收记录](../docs/evidence/desktop-app.md)。

当前源码内附 Electron 和 Pi `0.85.0`，运行已打包应用不需要系统 Node.js、bash 或 Pi 可执行文件。Pi 的首次登录和偏好配置仍需另外准备，应用没有登录向导；使用 DeepSeek API 不需要 Pi 认证。项目检查点需要本机 Git；用户配置的 MCP 服务可能另有运行环境要求。更新源码不会修改既有安装包，安全更新需重新构建并安装，见 [依赖安全修复](../docs/evidence/dependency-security.md)。

## 模型设置

| 方式 | 配置与当前行为 |
| --- | --- |
| **Pi · Codex** | 读取 Pi 的 Codex 模型偏好，认证和刷新由 Pi 自己处理；知行不读取认证文件。 |
| **DeepSeek API** | 默认 `deepseek-v4-flash`，界面还提供 `deepseek-v4-pro` 和实验性 `deepseek-v4-flash-vision-exp`。可复用原知行的 macOS Keychain 项，或在设置中添加桌面独立 Key。 |
| **自定义 API** | 在设置中填写 API 根地址、模型 ID、Key 即可添加兼容服务；支持多个连接、能力参数、独立加密和连接测试。详见[配置](../docs/CONFIGURATION.md#自定义-api-连接092)。 |
| **Kimi API** | `kimi-k3`，通过国内 `api.moonshot.cn` 连接，独立保存 API Key；可使用文字、图片及受控工具调用。 |
| **离线演示** | 固定的本地演示内容，不调用真实模型。 |

首次使用且没有偏好文件时默认选择 `pi-codex`；已有偏好优先，重启会恢复上次选择。因此本机保存为 DeepSeek 并不意味着产品默认值是 DeepSeek。找到 Pi 模型偏好或 API 配置只代表配置存在，认证、余额和网络在真实请求时检查。

切换方式会保留当前对话。Codex 回答失败时，消息下方提供「切换到 DeepSeek 重试」，由用户点击后在同一会话追加原问题，保留失败记录；不会自动回退。回答标注实际 Provider，并保存首字与总耗时。

### 准备 Pi 登录

如果已经通过 Pi 登录并选好 Codex 模型，可直接复用。需要首次登录时，在**已安装 Pi 的终端环境**运行：

```bash
pi
```

在 Pi 内执行 `/login`，选择 OpenAI Codex 并完成认证，再通过 `/model` 选择该 Provider 下可用的模型。回到知行设置刷新后重试。知行不保证任意账户可用或登录已成功；若暂未准备 Pi，可先配置 DeepSeek API。

知行读取 `${PI_CODING_AGENT_DIR}/settings.json`，未设变量时为 `~/.pi/agent/settings.json`；要求 `defaultProvider` 为 `openai-codex`、存在 `defaultModel`，推理强度缺失时为 `medium`。桌面的项目级覆盖来自其数据目录 `runtime/.pi/settings.json`，**不会自动读取源码仓库的 `.pi/settings.json`**。详情见 [配置说明](../docs/CONFIGURATION.md#pi-codex-接入)。

### Pi 需要本机代理时

终端与 Finder 启动的应用不一定继承相同的代理环境。如果 Pi 已登录却连接超时，可先退出知行，再通过终端为本次启动指定 HTTP 代理。以下为本机已验证的端口，其他机器应替换为自己的地址：

```bash
NODE_USE_ENV_PROXY=1 \
HTTPS_PROXY=http://127.0.0.1:15236 \
HTTP_PROXY=http://127.0.0.1:15236 \
NO_PROXY=localhost,127.0.0.1,::1 \
"$HOME/Applications/知行.app/Contents/MacOS/知行"
```

安装在系统 Applications 时改用 `/Applications/知行.app/Contents/MacOS/知行`。这些变量只影响这次启动及其子进程，不是应用持久设置；本次真实 Pi 与三家模型对照已通过此环境发送请求，见[代理复验](../docs/evidence/pi-proxy-20260909.md)。

### 添加 DeepSeek API

在设置中选择 DeepSeek API，输入 Key 后点击保存。主进程使用 Electron 异步 `safeStorage` 加密，保存为独立的 `deepseek.credential`；系统加密不可用时拒绝保存。macOS 临时签名包重新构建会改变钥匙串识别的应用身份；本地打包现在要求先[固定开发签名证书](../docs/macos-local-signing.md)，首次迁移时在系统弹窗中授权，后续复用同一证书。应用不接收系统密码。已有 Key 不回填到输入框，也不写入偏好或聊天 JSON。

读取顺序为桌面加密文件优先；没有该文件时，macOS 可复用 CLI 原有的知行 Keychain 项。桌面新增 Key 不会覆盖旧 Keychain 项，CLI 也不会自动使用桌面加密文件。配置页提供的状态不等于已通过真实连接检查。

### 添加 Kimi API

在 Kimi 国内开放平台创建 API Key，再在知行“设置 → Kimi API”中输入并保存。无需购买聊天会员；K3 的账户充值开通要求以[官方指南](https://platform.kimi.com/docs/guide/kimi-k3-quickstart)为准。默认模型为 `kimi-k3`，接口固定为 `https://api.moonshot.cn/v1/chat/completions`。

密钥保存为独立的 `kimi.credential`，与 DeepSeek 使用相同的主进程系统加密、文件权限和不回填规则。macOS 可复用 CLI 的 `keychain:zhixing/kimi-api` 项。切换模型时清空未保存的密钥输入，不将 DeepSeek Key 用于 Kimi 请求。

两家 API 都提供“测试连接”：只发送一条简短合成问题，显示首字和总耗时，不发送学习资料或写入聊天记录；会产生少量 API 用量。配置存在不等于连通测试通过。

Kimi K3 始终开启思考；快速、均衡、深入分别映射为 `low`、`high`、`max`。仍遵守应用的上下文预算、受控工具和统一记忆策略。适配器时限 150 秒，总任务时限 180 秒；连接测试最长 60 秒。验收范围见 [Kimi 接入记录](../docs/evidence/kimi-api-20260909.md)。

## 对话与快捷键

支持会话搜索、重命名、Markdown 导出、代码/回答复制、数学公式、停止/继续/重试、每会话草稿，以及跟随系统/浅色/深色主题。回答风格可设为简洁、自然或详细，本轮明确要求优先。

| 操作 | 快捷键 |
| --- | --- |
| 发送消息 | Enter；中文输入法候选确认不会发送 |
| 换行 | Shift+Enter |
| 新对话 | Cmd/Ctrl+N |
| 搜索会话 | Cmd/Ctrl+K |
| 打开设置 | Cmd/Ctrl+, |

全应用同一时间只生成一个回答，期间可浏览其他会话或编辑草稿。点击停止会保留已生成文本；继续和重试会发起新请求。只有消息视图位于底部时自动跟随，向上阅读后可点击回到底部。Markdown 导出保存当前会话，不包含草稿或 CLI 学习数据。

## 数据与当前范围

会话与偏好保存在 Electron `appData` 下的 `Zhixing`，macOS 通常为 `~/Library/Application Support/Zhixing`，Windows 通常为 `%APPDATA%\Zhixing`，独立于 CLI 工作区。

```text
Zhixing/
  conversations/<UUID>.json
  preferences.json
  deepseek.credential       # 添加 DeepSeek Key 后创建
  kimi.credential           # 添加 Kimi Key 后创建
  runtime/
  workspace.json           # 显式连接的工作区路径
  workspace/               # 默认学习工作区
```

草稿和最近会话标识另存于应用 localStorage。源码启动和已安装应用默认使用同一桌面数据目录；不会自动迁移、合并或同步 CLI 的会话、资料和学习进度。

每个会话最多 20,000 条消息，旧历史按 250 条分段保存，达到上限需要新建；完整会话合计最多 12,000,000 字节。单次输入最多 20,000 字符，回答最多 64,000 字符；发送给模型的历史最多 24 条、40,000 字符，再加本次输入、约束、摘要和授权的学习上下文，较早的本地历史不会因上下文裁剪被删除。默认 48,000 输入/输出估算 token 窗口、16,384 输出 token 预留，可在设置中调低；完整旧工具轮次可被裁剪而不修改历史原文；该估算不是模型精确计费值。普通任务最多 6 个模型回合，已连接项目为 12 个。生成总时限为 180 秒，DeepSeek 的 60 秒或 Pi 的 150 秒适配器超时可能先结束请求。

0.3 已提供主题、课程、资料导入/引用、进度和证据验收入口；CLI 的个性化课程生成、长期记忆管理等高级管理命令仍保留在 CLI。连接工作区共用学习数据，聊天仍分别保存。

会话使用原子文件写入，重启后未结束的回答显示为中断。正常停止会保存部分文本；进程被强制结束仍可能丢失尚未落盘的增量。损坏文件会保留，不会自动清空整个会话目录。

## 从源码开发

使用 Git、Node.js `24.8.x` 和 npm，从尚未克隆的环境开始：

```bash
git clone https://github.com/muzigef/zhixing.git
cd zhixing
npm ci
npm ci --prefix desktop
npm run desktop
```

已有仓库时直接从两条 `npm ci` 开始。根包提供共享适配器、类型与测试依赖，桌面包提供 React、Electron、构建工具和内附 Pi；不能只安装根包就运行桌面。`npm run desktop` 会先构建，不含自动监听重建。

在根目录运行质量门和桌面验证：

```bash
npm run verify
npm --prefix desktop run build
npm --prefix desktop run test:ui
```

`verify` 包含根/桌面类型检查和核心单元测试，但不启动 Electron UI。`test:ui` 自动准备运行时并构建，在隔离临时数据目录启动真实 Electron，禁用真实 Provider 并使用临时 Pi 偏好，不读取真实认证。测试涵盖内附 Pi 在清空 PATH 后启动、流式文本、数学、复制、导出、取消、历史、草稿、中文输入法、模型切换、设置恢复和窄窗口；结束后清理测试数据。测试结果不能证明真实 Provider 已认证。

手动执行 `ZHIXING_ALLOW_LIVE_PROVIDER=0 npm run desktop` 会禁用真实 Provider，但仍使用正常数据目录，且不会自动选择离线演示；需要在设置中自行选择。环境变量只影响启动后的进程，不会更改已运行应用的环境。

## 构建安装包

在 macOS Apple Silicon 构建机的仓库根目录执行：

```bash
npm --prefix desktop run dist:mac
```

该脚本生成 `desktop/release/mac-arm64/知行.app`、DMG 和 ZIP，当前源码版本对应 `Zhixing-0.11.0-mac-arm64.dmg` / `.zip`；不代表这些安装器已经生成。上述本地命令不发布 Release 或安装到 Applications。macOS 须先[配置固定本地签名](../docs/macos-local-signing.md)；证书不可用时在修改旧包前失败。一次性测试包须显式设置 `ZHIXING_ALLOW_ADHOC=1`，其更新可能再次触发钥匙串询问；单独设置 `CSC_IDENTITY_AUTO_DISCOVERY=false` 不再允许静默生成临时签名包。

验证实际 `.app` 时，在 `desktop/` 内执行：

```bash
cd desktop
ZHIXING_DESKTOP_EXECUTABLE="$PWD/release/mac-arm64/知行.app/Contents/MacOS/知行" npm run test:ui
```

Windows x64 需在 Windows 构建机安装根/桌面两套依赖，然后从仓库根目录运行 `npm --prefix desktop run dist:win`，目标是 NSIS 安装包。`electronDist` 使用本机平台的 `node_modules/electron/dist`，当前配置不能直接在 Mac 上完成等价的 Windows 平台验证。

Electron 下载失败时，检查 npm registry、代理和 Electron 二进制获取过程；不要把缺失的 Electron 二进制误判为源码编译失败。已有镜像获取与官方 checksum 校验记录见 [验收记录](../docs/evidence/desktop-app.md)。保留完整性校验，不使用跳过 checksum 的选项。

## 可选 DeepSeek 检查

先完成依赖安装与 `npm --prefix desktop run build`。以下命令都在仓库根目录执行，使用 Playwright 启动源码桌面应用，不是运行系统中已安装的 `.app`。

默认只检查配置元数据，不发送模型请求：

```bash
node desktop/scripts/check-deepseek.mjs
```

脚本创建临时桌面数据和 Pi 目录，并显式允许检查旧 macOS Keychain 项。因此它检查的是**可复用的 CLI Keychain 配置**，不是正常桌面数据目录里的 `deepseek.credential` 或已保存的模型选择；临时偏好的默认模型是 `deepseek-v4-flash`。没有旧 Keychain 项时，即使正常桌面已保存独立 Key，也会显示 `configured: false`。输出只含配置状态、来源和模型，元数据检查不会验证 Key 有效性。

需要实际连通检查时才手动添加 `--live`；该选项会在脚本子进程中启用真实 Provider，并可能产生 API 费用：

```bash
node desktop/scripts/check-deepseek.mjs --live
```

只有找到配置时才发送「2+2 等于几？只回复一个数字。」，输出最终状态、回答和首字/总耗时；未找到配置则跳过请求，不能因退出码为 0 就判断已连通。结果为 `completed` 才表示本次请求完成，单次短请求也不是长期性能基准。脚本不保存新 Key，完成后关闭测试应用并清理临时数据。

## 结构

- `core/`：输入契约、会话服务、原子存储、加密存储抽象。
- `electron/`：原生窗口、受限 IPC、Pi 打包启动、系统钥匙串衔接。
- `renderer/`：React 聊天界面与本地 Markdown / KaTeX 渲染。
- `scripts/`：构建、UI 验证、图标生成及可选 DeepSeek 连通检查。

复用仓库 `src/pi-client.ts`、`src/deepseek-client.ts`、`responseGuidelines` 的协议校验与对话规则。Pi SDK 只生成应用工具请求，执行由受控 ToolHarness 管理；主进程只向 renderer 提供受校验的命令与消息；凭据不会回传到 renderer。

继续阅读 [配置](../docs/CONFIGURATION.md)、[开发](../docs/DEVELOPMENT.md)、[测试](../docs/TESTING.md) 和 [架构](../docs/architecture.md)。

## 学习任务与发布

选择主题并打开“课程与资料”管理学习日、资料和真实证据；模型使用学习上下文需勾选本会话授权。运行时支持排队、立即调整、停止后暂停队列与重启后手动恢复。具体操作及 CLI 等价命令见 [升级指南](../docs/agent-upgrade.md)。

`npm run prepare:runtime` 检查项目内 Electron 二进制和 SQLite ABI；`start`、`pack`、`dist:mac`、`dist:win` 与 `test:ui` 会自动调用。`npm run dist:host` 构建本机平台/架构，`npm run checksums` 生成安装器 SHA-256。GitHub Actions 的 `desktop-release` 工作流构建 macOS/Windows，验证实际应用并上传产物；tag 构建创建待发布草稿。三种平台的远端结果见 0.9 记录；Windows 证据来自真实 Windows runner，不能等同于所有用户 PC 的兼容性认证。Developer ID 签名/公证仍未配置。

## 当前源码的 Agent 内核更新

桌面现经共享 AgentService 处理任务、持久队列、原生工具审批/续接和完成检查，与 CLI 复用执行契约。会话保存为 v8，v1–v7 首次保存前保留对应原文件备份；读取本身不改写旧文件。旧版拒绝新格式，避免丢失审批和诊断字段。范围与证据见 [Agent 内核](../docs/agent-kernel.md)。

0.6 会话列表使用元数据索引和每页四十条加载，标题搜索覆盖完整历史；长对话默认呈现末四十条，可加载更早消息。学习资料、当前项目、外部工具分别授权，设置与恢复规则见 [会话权限](../docs/session-permissions.md)。

## 0.8 行为变化

教学练习状态绑定当前会话；新对话和分支从空检查点开始。课程面板可设置/关闭每日复习提醒，只在应用运行时检查；操作系统可能静音，错过五分钟不补发。MCP 支持 macOS restricted 隔离，其他平台明确拒绝此模式；项目测试按钮按实际平台能力禁用。性能诊断分离提交推理、输出上限、输入规模及传输条件，不混合不同比较条件。完整实现与本机验收见[修复记录](../docs/evidence/architecture-remediation.md)。

## 0.9 行为变化

桌面支持选择、粘贴或拖入 PNG/JPEG，CLI 使用 `/image`；两端通过共享图像契约，限制和视觉模型选择见[图片输入](../docs/image-input.md)。真实语义检索、第三方 MCP、系统通知和跨平台验收见[0.9 记录](../docs/evidence/completion-0.9.md)。

macOS 本地构建现在绑定并校验固定证书的应用签名，以保持更新前后的钥匙串身份；已有 ad-hoc 产物不会自动变为固定签名。一次性测试可显式选择 ad-hoc，两者均不等于 Developer ID 签名或公证。设置及验收边界见[本地签名说明](../docs/macos-local-signing.md)。应用退出前等待偏好写入，连续设置修改后的读取也等待已提交写入。真实教学研究仍需参与者、独立评阅者及实际 72 小时延迟。

### 动态添加模型服务

设置 → 自定义 API 连接 → 添加 API 连接。支持 OpenAI 兼容 Chat Completions / Bearer Key 接口，不再按厂家增加固定按钮。内置 Pi、DeepSeek 和 Kimi 不受影响。连接测试使用固定合成消息，不发送学习资料。更换端点/模型需添加新连接；移除配置保留对话和密文，旧任务不会悄悄切换服务。完整能力与协议边界见[配置说明](../docs/CONFIGURATION.md)。
