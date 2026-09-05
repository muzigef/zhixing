<!-- generated-by: gsd-doc-writer -->
# 快速开始

桌面版用于连续学习对话；CLI / REPL 用于课程、资料、练习与进度管理。它们分别保存数据和模型选择，桌面尚未接入 CLI 的学习工具。

## 直接使用桌面安装包

已有本地构建产物时，打开 `desktop/release/Zhixing-0.2.0-mac-arm64.dmg`，将「知行」拖入 Applications 后启动。当前已验收的是 macOS Apple Silicon、macOS 13.0 及以上的本地预览版，没有 Apple Developer ID 签名和公证；Windows 仅有构建配置，尚未实机验收。

安装包内附 Electron 和 Pi 运行时，运行应用不需要另外安装 Node.js。`desktop/release/` 被 Git 忽略，克隆仓库不会带上这些产物；从源码运行或构建见下文。更多使用说明见 [桌面版 README](../desktop/README.md)。

## 前置条件

以下条件用于源码开发和 CLI，不是已打包桌面应用的运行要求：

- Git、Node.js `24.8.x` 和 npm；CLI 启动时会校验 Node 版本。
- 根目录和 `desktop/` 各有一个 `package-lock.json`，完整开发/验证需要安装两套依赖。
- 可选：`tesseract` 和 `pdftoppm`，仅 CLI 扫描 PDF 的本地 OCR 需要。
- CLI 使用 Pi 时需系统中另有 `pi` 和 `bash`；使用 `codex-cli` 时需另有已登录的官方 Codex CLI。CLI 的 DeepSeek 凭据存储目前仅实现 macOS Keychain。

## 安装与首次运行

1. 克隆并进入项目，保留目录名 `zhixing`：

   ```bash
   git clone https://github.com/muzigef/zhixing.git
   cd zhixing
   ```

2. 安装依赖：

   ```bash
   npm ci
   npm ci --prefix desktop
   ```

3. 先检查本地 CLI 能否启动：

   ```bash
   npm run smoke:mock
   ```

   该命令在自动创建的临时工作区列出内置主题，禁用真实 Provider，结束后清理临时数据，不打开已有学习数据库。

4. 选择需要的入口：

   ```bash
   npm run desktop
   ```

   或在终端中进入学习工作区：

   ```bash
   npm run repl
   ```

`npm run desktop` 会先构建再启动 Electron，使用正常桌面数据目录；REPL 会使用正常 CLI 工作区。它们不是临时测试环境。

## 选择模型并开始对话

桌面新数据目录默认选择 **Pi · Codex**，不会自动切换成 DeepSeek。设置页可改为：

- **DeepSeek API**：macOS 可识别原知行 Keychain 配置，也可在桌面输入新 Key 并由系统加密保存。默认模型为 `deepseek-v4-flash`，可选 `deepseek-v4-pro`。
- **Pi · Codex**：复用 Pi 的模型偏好和登录。若尚未登录，在已安装 Pi 的终端环境中运行 `pi`，使用 `/login` 选择 OpenAI Codex，再用 `/model` 选择该 Provider 下可用的模型。知行当前没有内置 Pi 登录按钮；运行时内附 Pi 不等于已完成认证。回到知行设置刷新后再发起请求。
- **离线演示**：固定的本地演示回答，用于检查界面，不是真实模型。

已有桌面偏好会在重启后恢复；本机此前保存为 DeepSeek 与代码默认值为 Pi 并不冲突。Pi 偏好或 API 配置被找到，只说明配置存在，真实请求才能检查认证和网络。Codex 回答失败时可点击「切换到 DeepSeek 重试」，在同一会话追加一次请求；不会自动切换。

CLI 无本地路由设置时，tutor / reviewer / lab 均使用 `mock`。在 REPL 中配置 DeepSeek 的示例：

```text
模型添加 api-key deepseek-api
模型切换 tutor deepseek-api --确认
模型状态
解释 RAG 和微调的区别，用表格比较
```

如果已经配置并登录 Pi，可改用 `模型切换 tutor pi-codex --确认`。该命令只修改 CLI 的 tutor 路由，不改变桌面设置。Pi、官方 Codex CLI 和 DeepSeek 的完整配置、数据外发规则见 [配置说明](CONFIGURATION.md)。

## 最小 CLI 学习流程

新工作区从无跨主题前置条件的 `agent-development` 开始：

```bash
npm run start -- '学习 agent-development'
npm run start -- '开始第 1 天' --topic agent-development
npm run start -- '进度' --topic agent-development
```

执行一次 `学习 <主题>` 后，当前主题会保存在本机设置中，下次进入 REPL 自动恢复；`--topic <topicId>` 可为本次命令明确选择主题。RAG 课程要求先完成 `agent-development/D01` 和 `D02`，新工作区直接启动 RAG 第一天会返回前置条件提示。

`mock` 返回确定性的学习卡；真实 tutor 可生成讲解、追问和练习。需要自然制定计划时，可在 REPL 说「创建 3DGS 的学习计划」，回答必要问题，核对草案后按提示说「直接运行」或「直接运行 --确认」。模型生成草案后不会自行执行。日常交互示例：

```text
/style balanced
举个例子
来一道题
给出参考解析
/status
```

`balanced` 是 `adaptive` 的别名，风格按 CLI 主题保存。生成时可输入「停止」或按 Ctrl-C 停止本次回答；`/new` 新建对话，`/resume` 列出旧对话，`/exit` 退出。完成学习日仍需实际提供实现、测试、失败案例和复盘证据，再使用 Review 命令检查，不能把命令示例当作已完成的学习成果。

## 个性化学习流程（无需模型）

```bash
npm run start -- '设置学习画像 掌握 RAG 原理与实践 --水平 初学 --每天 45 --周期 14' --topic rag
npm run start -- '生成个性化计划' --topic rag
# 查看输出的版本号后：
npm run start -- '启用个性化计划 personal-plan-<version> --确认' --topic rag
npm run start -- '生成技能草案 rag-interview' --topic rag
npm run start -- '读取技能草案 rag-interview' --topic rag
npm run start -- '启用技能草案 rag-interview --确认' --topic rag
```

将 `<version>` 替换为生成命令返回的版本。画像、计划和 Skill 草案均按当前主题保存，上述操作不需要模型。若要额外运行 `学习建议`，它会使用当前 tutor 路由，发送画像与资料名称；该命令接受的 `--允许外发` 是兼容语法，不应与学习助手正文检索所需的按次授权混淆。

## 导入与查询资料

将文件放在 `inbox/<topicId>/`，例如 `inbox/rag/notes.md`，再执行：

```bash
npm run start -- '导入资料 rag/notes.md'
npm run start -- '查询资料 rag 检索如何提供引用'
```

资料默认只在本机处理。详见 [配置](CONFIGURATION.md) 与 [CLI 参考](CLI-REFERENCE.md)。

## 数据位置与离线验证

默认 CLI 工作根目录是源码仓库的父目录，数据写入其下的 `zhixing/data`、`zhixing/db`、`zhixing/settings`，学习笔记写入同级的 `learning-notes/`。`ZHIXING_ROOT` 覆盖的是这个父级根目录，CLI 会在其后追加 `zhixing/`；不要直接设为仓库目录而意外得到 `zhixing/zhixing/`。目录改名或切换工作根不会自动迁移旧数据。详见 [工作区配置](CONFIGURATION.md#cli-工作区与持久化设置)。

桌面使用系统应用数据目录中的 `Zhixing/`，macOS 默认为 `~/Library/Application Support/Zhixing/`，独立于 CLI；源码启动和已安装应用默认使用同一桌面数据目录。

运行完整检查：

```bash
npm run verify
npm --prefix desktop run build
npm --prefix desktop run test:ui
```

`verify` 包含 lint、根/桌面类型检查、Vitest、integration、eval、mock smoke、敏感内容扫描与 diff 检查，不包含 Electron UI 或真实模型连通检查。UI 测试自行使用临时会话和 Pi 配置，禁用真实 Provider，结束后清理测试数据；实际安装包还需单独验收。结果与命令细节见 [测试指南](TESTING.md)。

手动运行时，`ZHIXING_ALLOW_LIVE_PROVIDER=0 npm run repl` 或 `ZHIXING_ALLOW_LIVE_PROVIDER=0 npm run desktop` 只禁用真实模型请求，不创建临时数据，也不自动把已保存的真实模型改成 mock/demo。

## 常见启动问题

| 现象 | 处理 |
| --- | --- |
| `unsupported_node_version` | 切换到 Node.js `24.8.x`，再安装依赖。 |
| `verify` 找不到 React / Electron 类型 | 根目录依赖之外，还需运行 `npm ci --prefix desktop`。 |
| 找不到安装包或 `build/main.mjs` | 源码仓库不包含构建产物；运行 `npm run desktop` 启动源码版，或按桌面 README 构建安装包。 |
| Pi 配置已读取但请求失败 | 配置与认证分别检查；在 Pi 中确认登录和 Codex 模型，再重试或手动切换 DeepSeek。 |
| 已设置 `ZHIXING_ALLOW_LIVE_PROVIDER=0` 仍无法得到回答 | 该变量会拒绝真实请求；CLI 选择 mock 或桌面选择离线演示才能获得本地演示输出。 |
| 扫描 PDF 为 `ocr_required` | 检查 `tesseract` 和 `pdftoppm`，或改用文字 PDF/Markdown。 |

更多问题见 [故障排查](TROUBLESHOOTING.md)。修改代码前继续阅读 [开发指南](DEVELOPMENT.md)、[测试指南](TESTING.md) 和 [架构](architecture.md)。
