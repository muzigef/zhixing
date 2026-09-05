<!-- generated-by: gsd-doc-writer -->
# 开发指南

## 本地开发环境

从仓库根目录开发，使用 Node.js `24.8.x`。CLI 会通过 [`src/runtime-version.ts`](../src/runtime-version.ts) 在启动时拒绝其他版本；CI 固定 Node `24.8.0` 和 npm `10.9.2`。项目没有声明 npm 的 `engines` 约束，建议本地沿用 CI 的 npm 版本。

CLI 与桌面是两个独立 npm 包，各有自己的锁文件，不是 npm workspaces。首次检出或锁文件变化后需要安装两套依赖：

```bash
npm ci
npm ci --prefix desktop
npm run smoke:mock
```

根包 `zhixing-learning-agent` 当前版本为 `0.1.0`，桌面包 `zhixing-desktop` 为 `0.4.0`；桌面安装包版本来自 [`desktop/package.json`](../desktop/package.json)。日常开发使用锁文件安装；有意新增或升级依赖时，在对应包执行 `npm install` 并提交对应 `package.json` 和锁文件。

CLI 使用 `better-sqlite3` 原生模块，真实 Keychain 集成和 `LocalSandbox` 的 `sandbox-exec` 封装依赖 macOS；本地扫描 PDF OCR 另外需要 `pdftoppm` 与 `tesseract`，普通 Markdown/文字 PDF 和模拟 OCR 测试不要求安装它们。桌面源码开发仍使用上述 Node 环境；安装后的桌面应用内附 Electron Node 和 Pi，不要求用户安装系统 Node/Pi 可执行文件，但 Pi 认证仍需单独配置。平台交付范围见[桌面说明](../desktop/README.md)。

## 开发循环

修改 CLI 或核心服务时，先用相关失败/边界测试定位行为，再运行受影响测试和质量门。日常离线交互可执行：

```bash
ZHIXING_ALLOW_LIVE_PROVIDER=0 npm run repl
```

该命令仍使用本机配置的 CLI 数据目录；自动化测试和 `smoke:mock` 会创建临时数据根。CLI 的 `ZHIXING_ROOT` 默认是仓库父目录，数据路径和隔离配置见[配置说明](CONFIGURATION.md)，不要用真实学习资料做开发夹具。

修改桌面时：

```bash
ZHIXING_ALLOW_LIVE_PROVIDER=0 npm run desktop
```

在设置中选择“离线演示”体验界面。`desktop start` 每次先准备 Electron/SQLite 运行时并构建，再启动 Electron；当前没有文件监听或热更新脚本，修改后重新运行。UI 回归会自动准备运行时和构建：

```bash
npm run desktop:build
ZHIXING_DESKTOP_LIVE_CHECK=0 npm --prefix desktop run test:ui
```

提交前执行：

```bash
npm run verify
```

`verify` 已包含 lint、根目录类型检查，以及桌面类型检查、Vitest、integration、eval、mock smoke 和静态扫描。桌面 UI 与实际安装包验证需要另外运行，见[测试指南](TESTING.md)。

## 脚本与构建命令

以下命令从仓库根目录执行，定义以 [`package.json`](../package.json) 为准。

| 命令 | 作用 |
| --- | --- |
| `npm run start -- '主题列表'` | 执行单条 CLI 命令 |
| `npm run repl` | 启动持续输入的终端交互 |
| `npm run lint` | 检查 `src`、`tests` 与桌面 core/electron/renderer |
| `npm run typecheck` | 根目录 TypeScript 类型检查 |
| `npm run test` | 全部 Vitest 测试 |
| `npm run test:integration` | `tests/integration.test.ts` |
| `npm run eval` | `tests/eval.test.ts` 固定行为评估 |
| `npm run test:harness` | Agent 调用、工具、Provider、教学与 CLI 的定向测试集合 |
| `npm run smoke:mock` | 隔离临时根目录、禁止模型外发的 CLI 冒烟 |
| `npm run fixtures:generate` | 重新生成无敏感 PDF/Markdown 夹具；不生成预置的 `encrypted.pdf` |
| `npm run verify` | 完整本地质量门与扫描 |
| `npm run pi:safe` | 通过审查过的安全脚本启动 Pi，开发环境需可用的 Pi CLI |
| `npm run desktop` | 桌面构建并启动 |
| `npm run desktop:build` | 只构建桌面 |
| `npm run desktop:pack` | 构建 macOS arm64 DMG/ZIP，等价于桌面的 `dist:mac` |

桌面独立脚本定义于 [`desktop/package.json`](../desktop/package.json)：

| 命令 | 作用 |
| --- | --- |
| `npm --prefix desktop start` | 构建后运行 Electron |
| `npm --prefix desktop run build` | esbuild 生成主进程 ESM、preload CJS、renderer 和 Pi 守卫 |
| `npm --prefix desktop run typecheck` | 桌面 TypeScript/TSX 类型检查 |
| `npm --prefix desktop run pack` | 构建后输出当前平台应用目录，不生成安装器 |
| `npm --prefix desktop run dist:mac` | macOS arm64 DMG/ZIP |
| `npm --prefix desktop run dist:win` | Windows x64 NSIS；需在 Windows 构建机执行并验收 |
| `npm --prefix desktop run test:ui` | 自动准备运行时、构建，再执行原有和学习流程两套真实 Electron 回归 |

构建代码见 [`desktop/scripts/build.mjs`](../desktop/scripts/build.mjs)。`build/` 是编译产物，`release/` 是打包产物，二者都位于 `desktop/` 下且不提交。当前 `electronDist` 使用本机 Electron 二进制，不能把 Mac 上打包的结果当作已经过 Windows 验证。签名、公证及 Windows/Intel Mac 平台验收尚未完成；版本检查提供公开发布说明，不自动安装更新。

## 代码风格与模块边界

ESLint 使用根目录 [`eslint.config.js`](../eslint.config.js)，通过 `npm run lint` 运行；TypeScript ESM 开启 `strict` 与 `noUncheckedIndexedAccess`。根目录 [`tsconfig.json`](../tsconfig.json) 与 [`desktop/tsconfig.json`](../desktop/tsconfig.json) 分别覆盖 CLI/测试和桌面代码。

Prettier 是桌面开发依赖，当前没有独立格式配置或 `format` 脚本，也没有 CI 格式化门。保持所修改文件现有风格，不为小改动重新格式化整个仓库。

- CLI 组合根是 `src/cli.ts`。新增命令同时核对 `action-registry.ts`、`interaction-protocol.ts`、`intent-parser.ts` 的识别与授权规则，以及实际命令处理器；目前旧处理器还没有完全统一到注册表分派。
- 确定性学习状态留在 `LearningRuntime`；模型意图、回答文本和工具请求不能直接宣告学习完成或绕过用户原文证据校验。
- 模型协议复用 `src/model.ts` 及 Provider adapter。桌面通过共享 Assistant Runtime 执行有界模型/只读学习工具循环；不要从 renderer 直接访问文件、凭据或网络。
- 桌面原生能力与 IPC 放在 `desktop/electron/`，可测试的会话/存储逻辑放在 `desktop/core/`，界面与 Markdown 展示放在 `desktop/renderer/`。详见[架构](architecture.md)。

## 工程约束

- TypeScript ESM，严格类型检查。
- CLI 主题由 `topicId` 隔离，受控主题路径经 `PathPolicy`；桌面使用独立系统应用目录和 `DesktopStore` 的路径/大小检查。
- CLI 未配置真实 Provider 时使用 mock，桌面提供显式离线演示；已配置的真实 Provider 默认可用，`ZHIXING_ALLOW_LIVE_PROVIDER=0` 可禁止外发。应用不把凭证和审计原文加入模型内容，API Key 仅用于受控请求认证；CLI 资料、记忆仅可作为受限当前主题上下文发送，并必须在调用层标记为用户材料。
- 不使用 focused/skipped 测试；`verify` 会扫描敏感信息和 diff 空白错误。
- 普通测试只使用 mock、内存密钥或假 Provider；不得读取用户凭证文件、写入真实 Keychain，或将真实用户材料作为夹具。真实连通检查是单独验收，不属于日常测试。

详细边界见[项目约束](pi-constraints.md)与[安全说明](../SECURITY.md)。

## 分支与 PR

当前主分支为 `main`，仓库没有规定强制分支命名，也未提供 PR 模板或分支命名检查。建议用能说明改动目的的分支名，并遵循[贡献指南](../CONTRIBUTING.md)：说明问题与最终行为、完成适用验证、同步文档和证据，最后提交供审查。

当前 [`verify` CI](../.github/workflows/verify.yml) 在 push/PR 安装两套依赖、运行完整 verify 与 Electron UI。`desktop-release.yml` 在手动触发或 v* tag 上构建 macOS/Windows、检查实际包 UI、上传安装器和校验和；tag 创建待发布草稿。远端执行结果需要 Actions 的真实记录，不能由本地通过替代。

新增命令：`npm run eval:agent`；桌面 `prepare:runtime`、`dist:host`、`checksums`。用法和切片契约见 [升级指南](agent-upgrade.md)。

0.4 的技能、问答/授权事件、执行数据、语义索引及迁移扩展见 [0.4 指南](agent-0.4.md)。运行完整回归与三套 UI；使用 `npm run eval:quality -- --live` 才执行临时合成数据的真实质量检查，不能将该命令混入普通 CI。
