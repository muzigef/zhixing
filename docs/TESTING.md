<!-- generated-by: gsd-doc-writer -->
# 测试与验证

## 框架与准备

根目录使用 Vitest（声明版本 `^3.0.0`，实际解析版本由 `package-lock.json` 锁定），桌面 UI 使用 Playwright（声明 `^1.55.0`）的 Electron API。仓库没有独立 Vitest 配置、全局测试 setup 或覆盖率阈值配置。

使用 Node.js `24.8.x`；CI 固定 `24.8.0`、npm `10.9.2`，本地建议使用一致版本。先在仓库根目录安装两套依赖：

```bash
npm ci
npm ci --prefix desktop
```

根目录与桌面分别使用自己的锁文件。Electron UI 验证需要图形环境与可执行的本机 Electron；`npm run verify` 不要求运行桌面窗口，但需要桌面类型依赖。安装和平台限制见[开发指南](DEVELOPMENT.md)。

## 运行测试

| 命令 | 目的 |
| --- | --- |
| `npm run lint` | ESLint 静态检查 |
| `npm run typecheck` | 根目录 TypeScript 严格类型检查 |
| `npm --prefix desktop run typecheck` | 桌面 TypeScript/TSX 类型检查 |
| `npm run test` | 全部 Vitest 单元与工作流测试 |
| `npm run test:integration` | 资料库和主题隔离集成测试 |
| `npm run eval` | 固定验收评估 |
| `npm run smoke:mock` | 临时根目录中的 CLI 冒烟，禁用真实 Provider，不接触用户数据库 |
| `npm run test:harness` | Agent loop、教学检查点、流式 Provider 适配的定向回归 |
| `npm run verify` | lint、根目录/桌面 typecheck、Vitest、integration、eval、mock smoke、敏感信息扫描与 diff 检查 |

完整本地质量门：

```bash
npm run verify
```

单文件或按名称筛选：

```bash
npm run test -- tests/desktop-service.test.ts
npm run test -- tests/deepseek-client.test.ts -t 'cancel'
```

没有预设 `test:watch` 脚本；需要监听时可使用已安装的 Vitest：

```bash
npx vitest tests/desktop-service.test.ts
```

测试数量随功能演进变化，以本次实际输出为准。[桌面验收记录](evidence/desktop-app.md)中的 58 个测试文件、281 个测试是当时运行的历史结果，不是固定门槛，也不能代替新改动的验证。

## 桌面 UI 与安装包验证

`test:ui` 不在根目录 `verify` 内，也不自动执行构建。开发应用回归从仓库根目录运行：

```bash
npm run desktop:build
ZHIXING_DESKTOP_LIVE_CHECK=0 npm --prefix desktop run test:ui
```

[`desktop/scripts/smoke.mjs`](../desktop/scripts/smoke.mjs) 为应用创建临时 `ZHIXING_DESKTOP_TEST_DATA` 与 Pi 模型配置，设置 `ZHIXING_ALLOW_LIVE_PROVIDER=0`。上面的命令同时明确关闭真实 Keychain 检查例外。测试覆盖：

- renderer 不暴露 Node `require`；内附 Pi 在清空 `PATH` 后仍可输出版本。
- 离线演示的流式文本、公式、代码、复制及 Markdown 导出内容。
- 停止后保留消息、重命名、搜索、历史/草稿/主题重启恢复。
- 中文输入法确认不误发、Shift+Enter 换行、窄窗口无横向页面溢出。
- Pi 失败后保持同一会话切换 DeepSeek，Provider 标识与 DeepSeek 模型设置持久化。

切换测试禁止联网，因此验证的是错误处理和切换链路，不是两个真实模型都回答成功。导出测试用固定临时目标替换系统保存对话框，验证实际 Markdown 文件；系统对话框的人工操作仍需产品验收。

脚本在正常结束或异常清理时删除临时测试数据；截图保存在系统临时目录下的 `zhixing-desktop-preview/`。复制测试会写入系统剪贴板。视觉验收应另行查看这些截图，自动断言不替代视觉检查。

交付 macOS arm64 安装包前，从仓库根目录构建并复测真实 `.app`：

```bash
npm --prefix desktop run dist:mac
ZHIXING_DESKTOP_LIVE_CHECK=0 ZHIXING_DESKTOP_EXECUTABLE="$PWD/desktop/release/mac-arm64/知行.app/Contents/MacOS/知行" npm --prefix desktop run test:ui
hdiutil verify desktop/release/Zhixing-0.2.0-mac-arm64.dmg
```

安装包文件名中的版本来自桌面包，升级后需同步替换。当前配置和已有验收针对 macOS Apple Silicon；Windows NSIS 构建配置不等于 Windows 实机测试通过，Intel Mac 同样尚未验收。

## 新测试与夹具

测试文件统一放在 `tests/` 下并使用 `*.test.ts`。已有测试通常直接从 Vitest 导入 `describe`、`it`、`expect`，在文件内建立小型 helper；使用 `fs.mkdtemp` 创建根目录，在 `afterEach` 清理，SQLite 连接先关闭再删除文件。不要把临时根设为实际学习数据目录。

Agent 故障覆盖：`agent-limits`、`agent-continuation`、`learning-agent`、`learning-agent-cli`、`tool-harness`、`provider-runtime`、`deepseek-client`、`run-manager`、`path-policy`、`teaching-turn` 与 `teaching-session-store`。其中 CLI 工具验收通过 Node preload 注入假 Keychain 和 fetch，使用临时 SQLite 夹具，验证真实入口和适配器而不访问真实凭证或网络。

桌面回归主要是 `desktop-service.test.ts`、`desktop-storage.test.ts`、`desktop-pi-runner.test.ts`、`desktop-providers.test.ts`，覆盖流式完成/取消、上下文边界、会话与设置保存、打包启动参数、失败切换及加密存储抽象。

[`tests/fixtures/README.md`](../tests/fixtures/README.md) 列出无敏感 PDF/Markdown 夹具。`npm run fixtures:generate` 重新生成文字 PDF、空文字层 PDF、501 页 PDF、损坏输入和 Markdown；`encrypted.pdf` 是单独预置的加密夹具，不由该脚本生成。OCR 测试可注入 `OcrEngine` 夹具，不代表真实 `tesseract`/`pdftoppm` 的本机验收已经完成。

新增行为先补充可观察的失败或边界测试，再实现最小改动；优先验证用户行为、授权、状态持久化和错误恢复，不复制实现细节作为断言。禁止 focused/skipped 测试，不忽略失败退出码。

## 外部调用与验证边界

普通自动化测试使用 mock/fixture，不需要真实 API Key、Pi/Codex 登录或用户材料。部分适配器测试把调用开关设为允许以覆盖成功分支，但同时注入内存密钥、假 fetch 或假进程 runner，不会因开关为 `1` 就调用真实服务。CLI `smoke:mock` 始终使用临时根目录和禁止外发开关。

全量测试应按上文运行标准 `npm run verify`，不要把交互开发用的 `ZHIXING_ALLOW_LIVE_PROVIDER=0` 统一添加到整个测试进程后视为等价验证。当前部分 CLI 工作流测试继承父进程环境：全局设为 `0` 时，`tests/cli-workflow.test.ts` 的 E40“学习建议”会被前置材料授权门拦截，报 `external_content_confirmation_required: routed`，即使其临时根使用 mock 路由也如此。材料门在 Provider 调用前检查，不能假设只作用于真实 Provider；这是当前测试环境边界，正常隔离由各测试自己的夹具和环境设置负责。

真实 Provider 连通检查属于单独环境验收，不能混入普通测试或把用户凭证写进夹具。桌面已有 DeepSeek 短请求的历史证据；Pi 内附运行时和协议测试通过不代表 Codex 登录有效。新密钥保存目前验证了可注入 cipher 的存储抽象及 Electron safeStorage 类型接口，真实系统 safeStorage 的“保存新密钥 → 解密读回”尚无验收记录。

## 覆盖率与 CI

当前没有配置 lines、branches、functions、statements 的最低覆盖率，也没有专用 coverage 脚本。质量门以测试行为和失败退出码为准；不要将测试总数解释为覆盖率。

[`verify.yml`](../.github/workflows/verify.yml) 中的 `verify` 工作流在 `push`、`pull_request` 触发，`quality` job 使用 `macos-latest`，依次安装 Node `24.8.0`、npm `10.9.2`，执行根目录 `npm ci --no-audit --no-fund`、`npm run verify` 和根目录生产依赖的 `npm audit --omit=dev --audit-level=high`。

当前 CI **缺少 `npm ci --prefix desktop`**，与 `verify` 已包含桌面类型检查的要求不一致，干净 runner 存在依赖缺口。本地应先按本页安装两套依赖；不能据此声称现有 CI 已覆盖桌面构建、UI、打包或桌面依赖审计，这些步骤都未配置在工作流中。

[`scripts/verify.mjs`](../scripts/verify.mjs) 还扫描源码/文档中的疑似凭证及 focused/skipped 测试，并执行 `git diff --check`。扫描排除依赖、用户 data/db/inbox、编译与发布产物等目录，是有限规则检查，不等于完整秘密检测或安全审计。
