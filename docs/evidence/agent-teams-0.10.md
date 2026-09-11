# 0.10 三模式开发验收

> 历史验收快照：下文的测试数量、失败、安装及“待验”状态仅适用于记录当次执行；未重新运行或改写历史结果。当前实现与后续进展见 [当前状态](../current-status.md) 和 [证据索引](README.md)。

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

V2 首次开发题复测曾在系统凭据准备阶段阻塞，后已通过应用设置实际验证 Kimi。用户提供本机代理后，Pi 真实通路恢复，完成同一包的 96 个留出根任务及逐条解释复核；普通 Pi 完整且正确 16/16，同模型团队 12/16，混合团队 8/16。团队未显示整体质量收益，应用段落要求误判、请求失败和成员未完成均保留，详见[质量对照报告](team-quality-comparison-20260909.md)及[代理复验](pi-proxy-20260909.md)。真实学生学习效果、跨平台安装和正式签名不属于此次合成回答质量验证；本机包为 ad-hoc 签名预览版。

## 代理恢复与正式对照后的交付复验

2026-09-09 本轮仅增加真实运行证据、解释复核和代理启动说明，同步 README/任务状态；未修改生产代码。无代理开发题、代理开发题和留出评测脚本均退出 0；退出 0 表示运行记录完成，不能把其中的模型错误或成员失败称为成功。96 行原始评分与汇总用原评分器复算一致，96 行解释复核与题目/组别/重复一一对应。

`CI=1 npm run verify` 再次退出 0：141 个测试文件、687 个测试，另 integration 9、eval 6、mock smoke，以及敏感信息和差异空白检查。日志 `/tmp/zhixing-team-proxy-final-verify.log`。另外检查本轮 13 个改动/新增文件的 JSON、文档本地链接及凭据特征，无无效 JSON、断链或敏感信息命中。

实际安装包与题目/评分器 SHA-256 均复验为上文相同值，评测期间没有重新签名。包清单中与仓库核对的 207 个 `src/`、`desktop/` 代码/配置文件，206 个一致；唯一差异是打包后添加失败诊断的 `desktop/scripts/smoke-team.mjs`，不影响应用运行代码。本次复用此前已通过七组 UI 的同一二进制执行真实模型对照，不将之前 UI、跨平台或签名验证描述为本次重新执行。
