<!-- generated-by: gsd-doc-writer -->
# 测试与验证

## 学习效果验证专项

教学验证的程序回归、真实接入与真实学习效果分别记录，见[使用与评估协议](learning-outcomes.md)及[本轮证据](evidence/learning-outcomes-20260907.md)。

```bash
npx vitest run tests/learning-outcomes.test.ts tests/desktop-outcomes.test.ts tests/outcome-report.test.ts tests/workspace-backup.test.ts
npm --prefix desktop run test:ui
npm run eval:learning -- export-a.json export-b.json --output=summary.json
```

UI 命令现包含聊天、学习、交互、`smoke-outcomes.mjs`、`smoke-projects.mjs` 和 `smoke-api.mjs` 六组 smoke，使用临时工作区、演示模型和合成作答。领域测试注入时钟检查 72 小时边界；产品没有绕过等待的测试开关。真实 Pi 合成接入检查另行显式运行：

```bash
npx tsx scripts/check-learning-outcomes.ts --live --output=docs/evidence/learning-outcomes-live-latest.json
```

该脚本只完成两种方式各一轮真实模型回答和学后阶段切换，不制造真实学习者或延迟学习效果。人工解释复核和真实 3 天学习仍需实际参与者完成。

## 框架与准备

根目录使用 Vitest（声明版本 `^3.0.0`，实际解析版本由 `package-lock.json` 锁定），桌面 UI 使用 Playwright（声明 `^1.55.0`）的 Electron API。`vitest.config.ts` 在 CI 中串行运行测试文件；没有全局测试 setup 或覆盖率阈值配置。组合进程流程有显式总期限，每个执行器保留自己的超时与取消约束。

使用 Node.js `24.8.x`；CI 固定 `24.8.0`，verify 工作流固定 npm `10.9.2`，本地建议使用一致版本。先在仓库根目录安装两套依赖：

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
| `npm audit --omit=dev --audit-level=high` | 联网检查 CLI 生产依赖安全，高危及以上导致失败 |
| `npm audit --prefix desktop --omit=dev --audit-level=high` | 联网检查独立桌面生产依赖安全 |

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

`test:ui` 不在根目录 `verify` 内，但会自动准备运行时和构建。开发应用回归从仓库根目录运行：

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
hdiutil verify desktop/release/Zhixing-0.9.0-mac-arm64.dmg
```

安装包文件名中的版本来自桌面包，升级后需同步替换。当前各平台结果见 [0.9 验收记录](evidence/completion-0.9.md)；Windows NSIS 构建配置不等于运行隔离或实包测试通过。

## 新测试与夹具

测试文件放在 `tests/` 下，主要使用 `*.test.ts`；MJS 验收 helper 的异步行为使用 `*.test.js`。已有测试通常直接从 Vitest 导入 `describe`、`it`、`expect`，在文件内建立小型 helper；使用 `fs.mkdtemp` 创建根目录，在 `afterEach` 清理，SQLite 连接先关闭再删除文件。不要把临时根设为实际学习数据目录。

Agent 故障覆盖：`agent-limits`、`agent-continuation`、`learning-agent`、`learning-agent-cli`、`tool-harness`、`provider-runtime`、`deepseek-client`、`run-manager`、`path-policy`、`teaching-turn` 与 `teaching-session-store`。其中 CLI 工具验收通过 Node preload 注入假 Keychain 和 fetch，使用临时 SQLite 夹具，验证真实入口和适配器而不访问真实凭证或网络。

桌面回归主要是 `desktop-service.test.ts`、`desktop-storage.test.ts`、`desktop-pi-runner.test.ts`、`desktop-providers.test.ts`，覆盖流式完成/取消、上下文边界、会话与设置保存、打包启动参数、失败切换及加密存储抽象。

[`tests/fixtures/README.md`](../tests/fixtures/README.md) 列出无敏感 PDF/Markdown 夹具。`npm run fixtures:generate` 重新生成文字 PDF、空文字层 PDF、501 页 PDF、损坏输入和 Markdown；`encrypted.pdf` 是单独预置的加密夹具，不由该脚本生成。OCR 测试可注入 `OcrEngine` 夹具，不代表真实 `tesseract`/`pdftoppm` 的本机验收已经完成。

新增行为先补充可观察的失败或边界测试，再实现最小改动；优先验证用户行为、授权、状态持久化和错误恢复，不复制实现细节作为断言。禁止 focused/skipped 测试，不忽略失败退出码。

## 外部调用与验证边界

普通自动化测试使用 mock/fixture，不需要真实 API Key、Pi/Codex 登录或用户材料。部分适配器测试把调用开关设为允许以覆盖成功分支，但同时注入内存密钥、假 fetch 或假进程 runner，不会因开关为 `1` 就调用真实服务。CLI `smoke:mock` 始终使用临时根目录和禁止外发开关。

全量测试运行标准 `npm run verify`。E40 明确设置 `ZHIXING_ALLOW_LIVE_PROVIDER=0`，证明 mock 学习建议不会被真实请求门禁误拦截；各 Provider 测试自行注入受控的网络或子进程夹具。

真实 Provider 连通检查属于单独环境验收，不能混入普通测试或把用户凭证写进夹具。桌面已有 DeepSeek 真实请求证据；Pi 内附运行时和协议测试通过不代表 Codex 登录有效。存储抽象验证加密写入/重读；系统 safeStorage 的合成字符串加解密在真实 Mac/Windows 应用中另行检查，不把两者合称为实际用户新密钥保存验收。

## 覆盖率与 CI

当前没有配置 lines、branches、functions、statements 的最低覆盖率，也没有专用 coverage 脚本。质量门以测试行为和失败退出码为准；不要将测试总数解释为覆盖率。

[`verify.yml`](../.github/workflows/verify.yml) 中的 `verify` 工作流在 `push`、`pull_request` 触发，`quality` job 使用 `macos-15`，依次安装 Node `24.8.0`、npm `10.9.2`，执行根目录与桌面两套 npm ci、两套生产依赖 audit、`npm run verify` 和 `npm --prefix desktop run test:ui`。[`desktop-release.yml`](../.github/workflows/desktop-release.yml) 也在构建前检查两套生产依赖；不忽略漏洞退出码。

本地 npm registry 不可达时，可以在安装/审计命令末尾临时添加 `--registry=https://registry.npmjs.org`，无需修改全局配置。依赖升级同时更新 `package.json` 与对应锁文件，再用 `npm ci` 验证可复现安装；PDF.js 和内附 Pi 的修复记录见 [依赖安全 Evidence](evidence/dependency-security.md)。

CI 已安装根目录与 desktop 两套依赖并执行 Electron UI。`desktop-release.yml` 另提供 macOS/Windows 的本机架构构建、实际包 UI、校验和与 draft release。既有基线保留历史含义；最新提交与平台运行链接见 [0.9 验收记录](evidence/completion-0.9.md)，不能用配置代替实际结果。

[`scripts/verify.mjs`](../scripts/verify.mjs) 还扫描源码/文档中的疑似凭证及 focused/skipped 测试，并执行 `git diff --check`。扫描排除依赖、用户 data/db/inbox、编译与发布产物等目录，是有限规则检查，不等于完整秘密检测或安全审计。

## 0.3 回归与人工质量集

`npm run eval:agent` 聚合 `agent-quality-eval`、`desktop-tasks`、`evidence-application`、`desktop-diagnostics`。新增 `smoke-learning.mjs` 验证真实主题/课程/进度、Markdown 和文字 PDF 导入、引用、产物 Review、本地 JavaScript 测试、排队/立即调整/停止/重启恢复、持久目标与主题隔离。与原有 UI smoke 同时在实际安装包运行。

[固定人工用例](agent-quality-cases.json) 用于实际 Pi/DeepSeek 回答质量，已执行的原答与复核见 [本轮 Evidence](evidence/agent-next.md)；自动夹具只证明协议和工作流结果。性能统计按 Provider 分开，样本量与范围见 [升级指南](agent-upgrade.md)。本轮结果见 [Evidence](evidence/agent-upgrade.md)。

## 0.4 自动化与真实质量

新增覆盖结构化上下文、Pi SDK 工具桥接、推理/usage、幂等任务、问答/审批/分支、检索隔离、独立课程检查、全量备份与 v1/v2 迁移。第三套 `smoke-interactions.mjs` 验证具体审批、问题回复、分支对比、技能预览和备份恢复，开发与实际包使用同一脚本。测试只使用临时合成数据。

## 0.4.1 延迟回归

`tests/pi-latency.test.ts` 验证 SSE 默认值、显式 auto 对照、真实 worker/假公共 SDK、阶段及时间记录、协议失败时工具不执行、取消和超时。进度工具另覆盖未开始/前置阻塞与进行中状态。

真实性能复测使用已有 Pi 登录，只发送临时合成问题；必须显式传入 `--live`，新结果写入独立文件：

```bash
npm --prefix desktop run build
node_modules/.bin/tsx scripts/profile-pi-latency.ts --live --repetitions=3 --cases=text-balanced-sse,tool-balanced-sse --output=/tmp/zhixing-latency-new.json
```

脚本现通过正式 adapter 参数选择传输，不修改 worker 副本。历史对照及其旧脚本方法保留在 [原因分析](evidence/pi-latency-analysis-20260907.md)。本轮完成情况见 [修复记录](evidence/pi-latency-fix-20260907.md)。

`npm run eval:quality -- --live --output=docs/evidence/agent-quality-latest.json` 在临时合成工作区运行固定 12 题 × 两次独立会话 × 双 Provider；可加 `--provider=deepseek-api` 或 `--case=R02,R08`，用 `--reasoning=balanced` 检查默认思考档位；`--repetitions=1` 可缩小连通检查。无 `--live` 为 demo。首个完全不可用的 Provider 停止后续尝试，并明确记录 attempted=false。waiting 代表真实澄清或审批，不能当作连接失败；答案待审并不代表质量通过。相同输入、快速思考，记录原文、interaction、usage、首字与总耗时；复核者身份和理由另存。题目已用于开发回归，不能视为盲测。

远端发布矩阵包含 macos-15、macos-15-intel、windows-2022；手动签名分支缺少配置时失败，实际签名/公证依赖账户，不由 mock 证明。

## 三项 Agent P0 回归

`npm run verify` 覆盖共享服务、真实 CLI 的恢复/审批、执行检查点、跨入口租约、三处进程 SIGKILL、拒绝与重复审批、双 Provider 原生工具格式、完成检查、修复重测及备份授权。

深入回归另含跨实例会话修改与摘要竞争、队列执行交接、已保存回复后的继续入口、不同任务相同 callId 的隔离、计划步骤删除/条件降级拦截，以及实现变更后的旧测试结果失效。见[再次复核记录](evidence/p0-reaudit-20260907.md)。

后续契约检查覆盖排队权限跨重启保留、CLI 应用任务续接的调用方取消、持久纠正只取消旧批次、结果未知时拒绝不安全重放、测试通过后的真实进展识别，以及同批次内修复后重测。见[契约核查记录](evidence/p0-contract-audit-20260907.md)。

最新恢复边界回归增加事件订阅异常隔离、纠正后再次恢复的防循环判断、恢复工具与上下文预算、完成检查取消/超时，以及晚到核验不能覆盖新计划。运行 `npx vitest run tests/agent-service.test.ts tests/agent-recovery-boundaries.test.ts tests/task-execution.test.ts`；完整验收为 86 文件 / 419 测试、原专项 8/8、四组 Electron UI，见[最新核查记录](evidence/p0-recovery-audit-20260907.md)。本轮未重新连接真实 Provider。

## 0.5 / P1-P2 回归

上节的数量和未连接声明属于 P0 历史验收。本轮增量覆盖上下文预算、按需发现、回答修复、评分导入、学习观察、并行恢复、MCP 子进程和独立实践 Git 项目；会话迁移新增 v3 → v4 原文件备份及十二轮计时保存。定向运行：

```bash
npx vitest run tests/agent-context-budget.test.ts tests/agent-efficiency.test.ts tests/response-quality.test.ts tests/quality-review.test.ts tests/learning-observations.test.ts tests/agent-parallel.test.ts tests/mcp-tools.test.ts tests/practice-projects.test.ts tests/desktop-migration.test.ts
npm run verify
npm --prefix desktop run test:ui
```

桌面现为五组：聊天、学习、交互、学习效果、项目。第五组通过实际窗口修改文件、预览差异、运行失败/通过测试、保存 Git 检查点并重启核验；非 macOS 必须显示隔离不可用，不能将未运行记为通过。MCP 使用实际本地 stdio 协议夹具，未连接未指定的生产服务。

两套生产依赖审计：

```bash
npm audit --omit=dev --audit-level=high
npm audit --prefix desktop --omit=dev --audit-level=high
```

若镜像不提供审计接口，可仅对这次命令指定 `--registry=https://registry.npmjs.org`，不更改全局设置。报告接口错误不能当作零漏洞。

安装器仍须指定 `ZHIXING_DESKTOP_EXECUTABLE` 跑同一五组，再做 DMG 验证、只读挂载检查及 SHA-256 核验。当前完整结果、真实 Pi/DeepSeek 合成请求和失败修复记录见 [P1/P2 证据](evidence/agent-p1-p2-20260907.md)。质量题与人工评分用法见 [评测指南](agent-quality-evaluation.md)；真实参与者和三天复习效果不由这些自动化测试证明。

```bash
node --import tsx scripts/audit-agent-p0.ts
npm --prefix desktop run test:ui
node --import tsx scripts/verify-p0-live.ts --live --output=/tmp/zhixing-p0-live.json
```

专项脚本的八项失败会返回非零退出码。真实验收需先构建桌面 worker，仅经已配置 Provider 发送临时合成代码，验证审批后新服务续接及实际产物数量；普通质量门不依赖联网。结果见 [本轮 Evidence](evidence/p0-development-20260907.md)。

## 0.6 验证入口

```bash
npx vitest run tests/provider-tool-contract.test.ts tests/product-validation.test.ts tests/agent-permissions.test.ts tests/project-revisions.test.ts tests/desktop-migration.test.ts
node --import tsx scripts/benchmark-sessions.ts
npm run verify
npm --prefix desktop run test:ui
```

新增测试含原生双 Provider 的错误参数修正/断流不执行、撤回与崩溃组合、完整产品授权与检查作答隔离、变式题/旧卷评分、构建和协议分组、SQLite/会话版本、防止批量写权限变成删除权限、Python 文件/网络隔离及超时。历史报告的测试数量保持原时点；当前命令退出码和安装包验证见 [C01–C12 Evidence](evidence/agent-architecture-next.md)。

真实合成效果流程可用 `node --import tsx scripts/check-learning-outcomes.ts --live --provider=pi-codex --output=/tmp/zhixing-outcomes-new.json`，Provider 也可选择 `deepseek-api`。它只证明实际模型与协议衔接，脚本作答和演示都不能代表真实学习效果。完整产品默认记录构建来源、权限、调用数与逐轮模型条件。


## 0.7 统一策略门禁

```bash
npx vitest run tests/agent-architecture-boundary.test.ts tests/agent-model-factory.test.ts tests/unified-agent-policy.test.ts tests/unified-learning-context.test.ts tests/interaction-cli.test.ts tests/pi-cli.test.ts
npm run verify
npm --prefix desktop run test:ui
```

真正启动 CLI 并对比桌面 DeepSeek 请求体，覆盖长普通/教学会话；共享服务另对比工具目录、摘要内容与来源、上下文用量，验证撤权与同主题教学竞争。Pi 测试启动同一个源码 worker，并通过合成公共 SDK 验证错误、取消和恢复；这些测试不读取真实凭据、不证明真实账号连接。完整备份测试验证恢复后不会继承教学租约。

发布前设置 `ZHIXING_DESKTOP_EXECUTABLE` 指向实际打包应用的可执行文件，重跑上面五组 UI。具体版本、命令退出码和未验证范围见 [U01–U04 Evidence](evidence/unified-agent.md)。

## 0.8 架构修复回归

`npm run verify` 覆盖连续摘要、相关记忆、会话分段/备份、独立教学检查点、真实回复契约、SDK 能力预算、同步访问码/活跃 SSE 关闭、提醒去重和跨平台预检。`tests/mcp-isolation.test.ts` 在本机实际启动沙箱子进程验证文件与网络拒绝，不只是断言参数。新增文件索引与每次执行结果见[架构修复证据](evidence/architecture-remediation.md)。

桌面五组 smoke 包含提醒设置/关闭、学习流程、MCP 连接、项目测试、任务恢复及效果报告。实际安装包验收使用 `ZHIXING_DESKTOP_EXECUTABLE` 指向打包后的应用可执行文件再运行同一 UI 命令；不能用开发目录启动替代。UI 全部采用临时数据和演示模型，不证明 OS 通知一定送达、真实学习效果、Apple 签名或其他平台已通过。

## 0.9 新增验收

- `tests/image-input.test.ts`、实际 CLI 图片协议及桌面 UI：格式/配额、无图模型拒绝、失败保留、v8 历史/分支/导出和预算。`node desktop/scripts/check-vision.mjs --live` 只发合成图片到 DeepSeek Vision。
- `node --import tsx scripts/check-deepseek-sequences.ts --live --output=new-report.json`：2400 条历史、实际回读、停止与后续恢复。
- `tests/outcome-blind-review.test.ts` 与 `scripts/create-outcome-review-pack.ts`：独立评阅准备，不生成真人评分。
- Windows 先运行 `node scripts/build-windows-sandbox.mjs`，再执行 `npx vitest run tests/windows-sandbox.test.ts tests/platform-preflight.test.ts`；macOS 不能代替 Windows 分支验收。
- `node --import tsx scripts/check-mcp-upstream.ts --mcp-root=/absolute/path/node_modules`：显式安装官方文件 MCP 服务后，实际 restricted 连接、白名单查询和未注册写操作拒绝。
- `node --import tsx scripts/check-semantic-model.ts --model=embeddinggemma --output=new-report.json`：本机已有真实模型时，检查中英文相关查询、隔离、取消和词法回退；不会自动下载模型。
- `node desktop/scripts/check-notification.mjs --native`：真实调度与原生通知事件；使用 `ZHIXING_DESKTOP_EXECUTABLE` 选择实包。若 OS 回调失败，验收应报告失败，不能以调用 show 代替显示成功。

本轮不运行真实 Pi 排障；Pi 相关 Vitest 使用离线 SDK/协议夹具。旧留出集 H03 已用于修复，整个旧集合按回归集记录，不再称为未见盲测。独立人工评分及真实学习效果仍需外部人员。

Windows 发布流水线会把实际 NSIS 安装到一次性 runner 的独立目录，核对 6 个关键运行文件，再针对安装路径执行五组 UI；安装回执作为 artifact 保留。手动定位可选 platform，tag 发布始终运行全部平台。异步 IPC 条件使用有总期限的 `waitForIpc` 逐次等待，不能把 Promise 对象当成条件已满足。

默认 UI 回归使用隔离的合成数据，不主动访问系统加密。显式设置 `ZHIXING_DESKTOP_NATIVE_CIPHER=1` 可增加真实 safeStorage 的合成加解密检查，IPC 等待上限 20 秒；两个 GitHub 工作流都强制启用此检查，失败不能忽略。虽然没有读取已有 API Key，macOS 仍可能要求访问系统管理的主密钥，尤其在预览包重新签名后。本机需要用户在系统界面处理授权；未授权时应记录未验收，不应将普通 UI 通过替代这一结果。

如果本机全局 npm 镜像不可用，可仅为本次审计追加 `--registry=https://registry.npmjs.org`，分别执行根目录与 desktop 的 `npm audit --omit=dev --audit-level=high`，保留最初的网络失败记录，不更改全局配置。

## Kimi API 回归（2026-09-09）

`npm run verify` 包含 Kimi/DeepSeek 共享传输、密钥隔离、推理参数、原生工具续接、断流拒绝执行和连接探针测试。`npm --prefix desktop run test:ui` 在原五组后增加 `smoke-api.mjs`：隔离目录中验证两家 Key 保存、切换清空草稿、连接测试、Kimi 会话标签、重启恢复和 DeepSeek 回归。

新增 UI 测试使用合成密钥、模拟 HTTP 和模拟 OS cipher，不读取现有 Key，不证明真实账户或原生加密成功。实际包使用相同 `ZHIXING_DESKTOP_EXECUTABLE` 变量复测六组。真实账户验收通过用户本机保存 Key 后点击“测试连接”进行，见 [Kimi Evidence](evidence/kimi-api-20260909.md)。

## 动态 API 连接验证

`tests/api-connections.test.ts` 覆盖公开配置校验、修订冲突、身份绑定、独立密文、无回退路由、能力/预算/参数、安全错误、断流、实际 loopback HTTP 重定向拒绝及取消。`provider-tool-contract.test.ts` 对自定义服务验证 ToolHarness 参数失败修复和断流不执行工具；`interaction-cli.test.ts` 覆盖实际 CLI 配置与重启、长普通/教学对话和桌面相同请求；`workspace-backup.test.ts` 验证只恢复公开定义。

`smoke-api.mjs` 覆盖内置 Kimi/DeepSeek 回归，以及自定义服务添加、改名、Key 留空保留、切换、连接测试、会话徽章、重启恢复、移除后无回退和配置冲突。HTTP 与 cipher 使用隔离合成夹具；此测试不证明任意厂商接口或真实系统加密。实际打包应用使用 `ZHIXING_DESKTOP_EXECUTABLE` 运行同一套六组 UI。

真实本机 Kimi/DeepSeek 探针可在正常退出应用后，显式执行 `node desktop/scripts/check-installed-api.mjs --live --provider=kimi-api`。它打开安装应用并调用受控 IPC，不输出凭据、不创建对话，可能产生少量 API 用量。真实记录见[本轮 Evidence](evidence/dynamic-api-20260909.md)。
