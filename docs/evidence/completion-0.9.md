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
