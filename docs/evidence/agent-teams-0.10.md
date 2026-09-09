# 0.10 三模式开发验收

日期：2026-09-09。前置 0.9.2 提交 `65975b29b7bdd8fdec7cb08c4a90f9054c723085` 已推送并核对 `origin/main`。本记录仅覆盖此次三模式增量，不重写历史版本的验收结论。

## 已实现的行为

- 单 Agent 默认；同模型团队固定主模型的实际 ID，异模型团队验证实际模型的多样性，支持已配置的动态 API 连接。
- 主模型进行一次分工，最多两个成员独立只读核查，再由主模型综合。成员复用 `runAssistantTask`、ToolHarness、上下文裁剪及格式/证据核对；两个入口共用 AgentService。
- 上下文分享默认关闭；开启仍受原会话权限限制。成员不能写入、批准操作、追问用户或递归委派。结果按不可信观察数据处理。
- 请求前持久化共享预算；未知用量不当作零。按连接限制并发，同一 Pi 连接串行。取消覆盖等待与执行中的成员。
- 团队会话 v9 保留旧格式副本，旧应用无法降级覆盖。实际进程强杀后恢复已完成结论，未知成员不自动重复请求；用户可明确新建任务完整重跑。
- 桌面三模式选择、成员来源/状态/结果、停止及重跑；CLI `/mode`、`/team` 与公开配置持久化。

第一版没有动态任务依赖图、递归、成员自由通信、自动多轮补查或团队写入；不能把原研究方案中所有远期能力列为已完成。

## 测试证据

根目录与桌面依赖均执行 `npm ci --registry=https://registry.npmjs.org`，退出 0。没有新增生产依赖。

| 验证 | 命令或测试 | 结果 |
| --- | --- | --- |
| 模型与配置 | `team-contracts.test.ts` | 同模型冻结、异模型真实 ID 检查、参数边界 |
| 共享预算 | `team-budget.test.ts` | 请求前预留、主模型额度、未知用量、按连接并发、存储失败拒绝请求 |
| 成员隔离 | `team-isolation.test.ts`、`team-coordinator.test.ts` | 独立上下文、只读工具和延迟发现、显式共享、准备阶段、可选成员部分失败 |
| 生命周期 | `agent-team-service.test.ts`、`team-crash-recovery.test.ts` | 默认单 Agent、四次真实 mock HTTP 调度、v9/备份、新任务重跑、SIGKILL 后无重复成员请求 |
| CLI | `interaction-cli.test.ts` | 跨进程模式持久化及同模型实际分工/成员/综合 |
| 评分器 | `team-evaluation.test.ts` | 数值精度、资料集合、无效 JSON、偶数样本中位数、失败保留分母、答案不泄露给模型 |
| 全量 | `CI=1 npm run verify` | 141 文件、687 测试，另 integration 9、eval 6、mock smoke；退出 0，日志 `/tmp/zhixing-team-complete-verify.log` |
| 生产依赖 | 根目录与 `desktop/` 的 `npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org` | 两套均 0 vulnerabilities，退出 0 |

打包回归发现设置表单通过延后 effect 清理草稿时，切换模型会短暂带入上一家的未保存 Key。已有 `smoke-api.mjs` 断言真实失败后，将设置表单按 provider 重新挂载，避免跨连接复用草稿。修复后的 `smoke-api.mjs`、全量 `CI=1 npm run verify` 和实际包完整七组 UI 均退出 0，日志分别为 `/tmp/zhixing-team-settings-isolation.log`、`/tmp/zhixing-team-settings-verify.log`、`/tmp/zhixing-team-delivery-ui.log`。

中途实际包团队 smoke 曾出现一次等待发送按钮超时（`/tmp/zhixing-team-settings-pack-ui.log`）；添加隔离夹具失败状态诊断后，单独团队 smoke 及完整七组均通过，未稳定重现。保留此不确定性，不将一次重跑通过描述为已定位根因。

`npm --prefix desktop run pack` 与 `codesign --verify --deep --strict` 均退出 0。用于真实 V2 评测的 0.10.0 包 `app.asar` SHA-256 为 `6245b383ca0dea2decac5d700d4baa3f2be496f5722d7c3b8f9bd2e4aa03b7ff`；题目/评分器文件 SHA-256 为 `9db908b2540c528b8d461e5dac8526c9fea1f6e1bbd6952c13f92b004e5964c5`。评测期间不重打包或改变评分器。

同一已验证包已安装至 `~/Applications/知行.app`，与候选包 `app.asar` 哈希一致且签名验证通过；0.9.2 应用二进制保留在 Git 忽略的安装备份目录。未删除或覆盖日常数据、模型配置或凭据，详见[安装记录](agent-teams-installation.json)。

## 真实模型评测

仅通过桌面受控 Provider 调用 Pi、DeepSeek、Kimi，题目为固定合成数据，不读取密钥或日常会话。评测会话存于此次创建的临时目录；逐行落盘，最终文件名唯一，失败不覆盖。

首次开发题 V1 的十二行保留在 [原始结果](team-evaluation-pilot-20260909094200252.json)。确定答案均正确，混合团队一次成员超时；随后请求计时显示 Kimi 有 57.7 秒的发送前准备等待。修复包含连接准备、Pi 串行调度和有界成员计时，见[协议 V2](../agent-team-evaluation-protocol-20260909.md)。旧报告偶数样本的 `medianMs` 取上中位数，后续版本已改为中间两值平均；历史原始行保留，最终分析统一从原始行重算。

V2 开发题复测在系统凭据准备阶段阻塞，96 个留出根任务未执行。已有六组初测未见团队正确率收益，团队增加等待与部分失败；完整证据和待完成条件见[质量初测报告](team-quality-comparison-20260909.md)。真实学生学习效果、跨平台安装和正式签名不属于此次合成回答质量验证；本机包为 ad-hoc 签名预览版。
