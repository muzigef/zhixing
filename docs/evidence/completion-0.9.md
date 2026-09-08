# 0.9 执行证据

范围与验收标准见[任务计划](../completion-plan.md)。本轮进行中，按真实退出码与产物更新；不将外部条件缺失标为完成。

## 起始状态

- 0.8 本机基线：603 测试、开发/实包各五组 UI、双生产审计与镜像核对，详见[既有记录](architecture-remediation.md)。本轮不重复宣称这些检查已重跑。
- GitHub CLI 已登录，当前远端最后一次 verify（32decd4）失败，需读取原因并验收新提交。
- 用户明确延期 Pi 故障和独立子 Agent；真实 Pi 请求不纳入本轮主动执行。

## R01 · 远端验证稳定性

- 基线已提交推送：78bef2d。此前远端失败集中为真实 CLI 子进程与沙箱测试超时；本机没有将这些超时解释成功。
- CLI 流程测试直接用当前 Node + 已安装 tsx，去掉每次 npx 解析/启动开销。补齐原无资料测试的临时工作区隔离。
- CI 明确使用 macos-15，与现有发行验证保持一致；Vitest 在 CI 上串行运行各文件，保留原测试时限及断言，不使用自动重试掩盖失败。
- `CI=1 npm run verify` 退出 0，603 测试及完整门禁通过，日志 /tmp/zhixing-r01-verify.log。新的 Vitest 配置纳入构建来源哈希。
- GitHub Secrets 列表为空；本机签名所需四个配置变量均未设置，仅检查存在性，未读取凭据内容。正式签名仍需外部条件。
- 58cfc05 远端 [verify 34244732465](https://github.com/muzigef/zhixing/actions/runs/34244732465) 实际 success，包含完整 verify、双审计和五组桌面 UI。

## R02 · 图像输入

- 共享请求、历史、摘要哈希、预算、v8 分段存储、v3 图片执行检查点；CLI 和桌面均走 AgentService。格式/尺寸/数量和模型能力在发送前校验。开发细节与限制见 [图片输入](../image-input.md)。
- 边界用例先失败后修复：不支持的模型不能请求网络；实际 CLI 图片协议保持像素；新会话图片被拒绝后附件保留。全套桌面五组 UI 实际通过，日志 `/tmp/zhixing-r02-ui.log`。
- 真实 DeepSeek Vision、两轮合成图片检查：颜色与数值全部正确；首轮 1932 ms、首文本 1811 ms，追问 1066 ms、首文本 995 ms。包含 UI 附件发送、重载持久化、追问像素保留和导出；日志 `/tmp/zhixing-r02-vision.json`。未调用真实 Pi。
- 全量测试暴露 DeepSeek 分别取两次结束时间导致 `requestMs > totalMs` 的边界；新增可确定复现的时钟测试，统一结束时间快照。`CI=1 npm run verify` 最终退出 0：125 文件 / 610 测试、integration 9、eval 6、mock smoke、双类型检查、lint 和扫描通过，日志 `/tmp/zhixing-r02-verify.log`。

## R03 · Windows 执行器候选与远端验收

- Windows 分支使用 AppContainer 无能力 SID、白名单继承句柄和禁止子进程属性；进程先挂起，绑定 Job Object 的单进程、512 MB 内存、关闭即终止限制后恢复。测试代码只获得独立临时运行时读权限及临时工作目录写权限；标准输入关闭、超时和取消均终止 Job。未安装 helper 时明确不可用，不降级为普通进程。
- CLI 构建命令 `node scripts/build-windows-sandbox.mjs`；桌面自动构建并装入 runtime。系统 .NET 编译器缺失即构建失败。Python 标准库以独立副本加载，排除 site-packages；未安装 Python 不冒充通过。
- 本机 `CI=1 npm run verify`、五组 UI 均退出 0（`/tmp/zhixing-r03-verify.log`、`/tmp/zhixing-r03-ui.log`）。macOS 本机测试不能验证 Windows 原生分支；远端 Windows 实际越界/网络/子进程/超时/取消及 Windows、Intel 实包 UI 仍待 Actions 结果。
- 首轮远端 34248279002 三个平台均真实暴露问题：Windows 创建 AppContainer 进程时报 203；ARM 打包将空 CSC_LINK 当目录；Intel 的 Python 发现规则未覆盖版本化 Xcode 与 Intel Homebrew。修复分别为：为可信 helper 及显式子进程环境保留必需的 LOCALAPPDATA 路径元数据（不传令牌或其他认证环境；路径元数据不授予目录读取权限）；未签名构建删除空签名环境项；支持受限的版本化 Xcode/Intel Homebrew Python 路径。`CI=1 npm run verify` 再次通过，日志 `/tmp/zhixing-r03-fixed-verify.log`；远端复跑待结果。

## R04 · DeepSeek 真实任务与质量回归

- 首轮主集 24 条、旧留出集 12 条，保留失败报告：R07 一次、H03 两次在证据检查中 blocked。不能把 completed 或未评分当正确率。
- 根据实际输出修复两个问题：回答检查反馈明确要求直接重写原回答；显式否认某个数值不再误算为正向量化断言，否认范围止于分句/转折，仍拦住相邻伪造数值。R07、H03 各两次真实复跑全部完成。被用于改进的旧留出题已成为回归题，不能再声称独立留出。
- 深入思考 R02/R06/R11 三条全部完成，耗时 19.348 / 2.756 / 10.352 秒；不是与 quick 随机对照。
- 合成项目实际完成 README 受控修改、测试通过和 Git 检查点，六项断言全通过，整个任务 13.979 秒。教学 direct/zhixing 均使用真实 DeepSeek 完成首轮并进入 post，仍是合成协议验收，不能证明学习提升。
- 2400 条会话准确回读序号 1500 的项目代号与规模，实际调用一次历史工具，3.018 秒。修复历史工具原 999 上限，改用共享 20,000 条配额。真实深思考请求停止后 6 ms 收尾为 interrupted，随后新问题 1.594 秒完成。
- `CI=1 npm run verify` 最终退出 0；详细原始输出与构建来源保存在本目录的 completion-* JSON。开发助手评分与真实独立评阅分开，后者待外部人员。

## R05 · 教学研究与独立评阅准备

- 完成[研究执行说明](../teaching-study-protocol.md)，明确同意、身份去重、实际 72 小时复习、帮助/失访、冻结构建、独立双人评分和题卷校准边界。
- 新增验证后的导出转盲评包工具，随机顺序和 ID，隐藏模式、模型、阶段、自动分数与既有评分；来源原文哈希和修订号单独留给负责人。活动中的验证暂不进入包，伪造选择题分数拒绝，历史导出不覆盖。解释正文可能自行披露信息，不能把字段隐藏等同于完全匿名。
- 先失败后实现的边界测试通过；`CI=1 npm run verify` 退出 0，日志 `/tmp/zhixing-r05-verify.log`。实际 CLI 合成导出生成 1 条评阅任务、0 条人类评分，输出目录权限受限。
- 外部验收未完成：没有收到真实参与者/评阅者条件，未采集真实学前/学后/延迟结果，未证明题卷等难。工程准备完成不能替代研究结果。

## R06 · 实际集成

- 实际运行官方 `@modelcontextprotocol/server-filesystem@2026.8.31`，在 macOS restricted 沙箱内完成握手、Schema 校验和 ToolHarness 白名单读取。未注册的写工具被拒绝，合成原文件保持不变。发现并修复 Draft-07 / 2020-12 方言兼容，未知方言、远程引用和非法输入仍拒绝；不把转换方言当作移除校验。可复现脚本 `scripts/check-mcp-upstream.ts --mcp-root=<已安装服务的 node_modules>`。
- `CI=1 npm run verify` 退出 0（`/tmp/zhixing-r06-verify.log`），实际 MCP 日志 `/tmp/zhixing-r06-mcp-final.json`。
- Ollama v0.33.3 官方归档 SHA-256 校验一致；真实 embeddinggemma 已完成下载、索引和语义/混合检索验收，见下文及 [原始结果](completion-semantic.json)。
- 系统通知最初在开发 Electron 中实际 failed，随后经完整 ad-hoc 签名实包观察到 show；原因、修复及正式签名边界见下文。

## R07 · 常驻 worker 评估

- DeepSeek 现有 30 次真实模型轮次：准备阶段中位数 18 ms，请求中位数 2730.5 ms，总计中位数 2753 ms。该链路已直接流式请求，不需要额外常驻 worker；即使完全消除准备阶段，可节省的量级也小于一次请求的百分之一。
- Pi 的常驻方案需在连通性稳定后测量冷/热启动、每轮请求、取消回收、内存和会话隔离。用户明确不处理 Pi 故障，本轮不启动真实 Pi 测量，也不引入未经收益验证的常驻进程。当前决策为维持按需进程；重新评估随 Pi 故障任务一并进行，不另建子 Agent。


## 后续实际复核

- Windows 第三轮已消除 CreateProcess 203，暴露 0xC0000142。改为无控制台的 DETACHED_PROCESS 后，真实 Node 输出、超时/取消和输出上限测试通过，复合越界用例仍在诊断，不能宣称 Windows 已验收。
- 远端桌面测试暴露设置读写竞态。新增真实文件回归先失败；读取等待已提交偏好写入，写失败后可读取最后提交状态，退出应用前等待保存。129 文件 / 618 测试的完整 verify 和五组开发 UI 通过；后续课程上下文修复再完整验证。
- 课程上下文将前置课名称混用的模型输出转成具体结构化回归。前置课程单独提供自己的名称、时长和要求，当前课程包含 topicId；其他主题私有记忆不进入上下文。真实 R06 两次复跑全部准确。
- 回答质量已逐条开发助手评分，严格门槛没有全通过。完整原答、评分与局限见[内容复核](completion-quality-review.md)，不得以完成状态、提高思考档位或程序测试冒充语义正确率。
- 真实 Ollama embeddinggemma 已实际索引与检索：模型 digest `85462619ee721b466c5927d109d4cb765861907d5417b9109caebc4e614679f1`，4 个中英文问题的语义与混合 Top-1 全部正确；索引 1619 ms，单题 68–97 ms；跨主题空结果、取消和缺失模型显式回退通过。报告 [completion-semantic.json](completion-semantic.json)。临时测试服务已关闭，没有修改应用的默认模型或全局安装配置。
- 通知根因：Electron 42 起使用 UNNotification，要求应用被完整签名（[官方变更说明](https://www.electronjs.org/docs/latest/breaking-changes#behavior-changed-macos-notifications-now-use-unnotification-api)）。原包只有链接器临时签名且 Info.plist 未绑定，实际报 UNErrorDomain 1。对应用完整 ad-hoc 签名并严格校验后，共享调度器触发一次通知，实际收到 show，无 failed。已加入 afterPack；正式 Developer ID 与公证仍未配置。
- Git 直连推送遇到连接故障后，使用 GitHub Git 数据 API 上传相同对象；逐个核对 blob/tree/commit SHA，并在确认远端为祖先后非强制更新 main。没有改写历史或假设远端已收到代码。

- macOS ARM64 在 12b40c4 的 [desktop-release 34254548206](https://github.com/muzigef/zhixing/actions/runs/34254548206/job/102156923461) 实际 success：完整 verify、开发/实包五组 UI、DMG/ZIP 和校验和上传均通过。该轮 Windows、Intel 失败记录不被 ARM 通过覆盖。
- Windows 使用继承标准句柄后，越界读写、私有目录写读与联网断言均通过，子进程创建立即返回 UNKNOWN；测试原仅接受 EPERM/EACCES 因而失败。[libuv 1.51 的错误映射](https://github.com/libuv/libuv/blob/v1.51.0/src/win/error.c) 对未列举的 Win32 错误返回 UNKNOWN；新回归同时要求子进程 PID 为 0、退出状态为 null，且相同解释器在宿主控制组确实启动成功，超时不算拒绝。
- Intel 实际日志显示多次 CLI / Python 执行组合超过原 5 秒默认总时限。只将这些组合任务的总期限改为 15 秒，每个 CLI 子进程另加 8 秒期限，Python 自身执行期限保持不变；不跳过断言或增加自动重试。

## macOS 安装与跨平台后续验收

- 本机安装版本由 0.6.0 升为 0.9.0，旧应用备份留在 `~/Library/Application Support/Zhixing-install-backups/0.6.0-20260909-011815/知行.app`；用户会话、资料、偏好和数据库没有被安装过程覆盖或删除。安装后主流程、学习流程与真实通知通过，见 [本机安装回执](completion-local-acceptance.json)。
- 本机冻结包来自干净提交 222a148，375 个源码输入与 provenance 逐个比对一致；DMG 只读挂载后核对应用元数据、app.asar、模型 worker、构建来源和 SQLite 原生模块；完整 ad-hoc 签名校验、DMG 校验通过。此后新增的验收脚本与用例另按对应提交记录，不冒充该包重新构建过。
- [34256012612 的 Intel job](https://github.com/muzigef/zhixing/actions/runs/34256012612/job/102161888490) 和 [ARM job](https://github.com/muzigef/zhixing/actions/runs/34256012612/job/102161888764) 均实际 success：全套 verify、开发/实包各五组 UI、DMG/ZIP、校验和与 artifact 上传。Windows 同轮仅原生隔离通过，桌面实践仍失败，继续收口。
- 远端 UI 的累计段数偶发断言失败已定位到验收脚本：Playwright 的同步谓词轮询将 Promise 对象当作真值，未等到异步 IPC 返回 true。三处改为逐次 await 且带总期限；新增 3 条测试覆盖异步 false、悬挂 IPC 超时和异常传播，失败到通过；完整 130 文件 / 622 测试及实际安装应用的交互流程通过。
- 实际安装应用的系统加密接口完成仅内存中的合成字符串加解密与不含明文检查；没有读取既有凭证或认证文件。该检查现纳入各平台主 UI 流程。

- Windows 运行时对照明确定位两处真实兼容问题：Node ESM 默认 realpath 查询盘符根目录被拒；Electron Node 模式主动重开 NUL 被拒。仅为私有常规文件副本启用 preserve-symlinks 参数，Electron 使用官方支持的 no-stdio-init 继承既有句柄；没有修改盘符/用户目录 ACL 或放开子进程/网络。5911b77 的原生 6 项检查及五组 Windows 开发 UI 实际通过，后续安装器步骤另行记录。[Electron 实现依据](https://github.com/electron/electron/blob/v44.2.0/shell/app/node_main.cc)。
- 取消测试加强为先观察当前隔离进程在自身工作目录生成的合成标记，再触发取消，最后确认进程回收后的临时目录已删除；只取消初始化中的复制不能冒充已运行容器被终止。对应远端复测仍待结果。
