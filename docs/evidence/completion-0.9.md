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
- 首轮远端 34248279002 三个平台均真实暴露问题：Windows 创建 AppContainer 进程时报 203；ARM 打包将空 CSC_LINK 当目录；Intel 的 Python 发现规则未覆盖版本化 Xcode 与 Intel Homebrew。修复分别为：仅向可信 helper 传必需的 LOCALAPPDATA（不会进入沙箱子进程）；未签名构建删除空签名环境项；支持受限的版本化 Xcode/Intel Homebrew Python 路径。`CI=1 npm run verify` 再次通过，日志 `/tmp/zhixing-r03-fixed-verify.log`；远端复跑待结果。

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
