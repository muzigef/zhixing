# 当前实现与验收状态

核对日期：2026-09-11。源码基线为 [`60570bc`](https://github.com/muzigef/zhixing/commit/60570bc3ecb53565a0fcdde1bced5315d69500fb)。本文汇总当前状态；历史计划、截图和验收记录描述的是各自执行时点，不自动覆盖为新版本结论。

## 代码与版本

| 项目 | 当前事实 | 依据 |
| --- | --- | --- |
| 根包 | `zhixing-learning-agent@0.1.0`；Node `24.8.x` | [package.json](../package.json) |
| 桌面 | `zhixing-desktop@0.11.0`；Electron/React | [桌面 package.json](../desktop/package.json) |
| 执行与策略 | CLI 与桌面共用 AgentService，学习与应用操作通过共享服务 | [架构](architecture.md)、[统一策略测试](../tests/unified-agent-policy.test.ts) |
| 会话 | 普通新会话 v8；按使用字段升级至 v9–v13，含成员资源策略的会话写 v13；旧版兼容和升级前副本不等于可安全降级 | [会话契约](../src/agent-session-contracts.ts)、[存储](../src/agent-session-store.ts) |
| 模型接入 | 三种 API 协议、10 家配置模板、通用原生执行器与厂商适配器 | [接入架构](provider-architecture.md) |
| 模式 | 单 Agent、同模型团队、异模型团队；默认单 Agent | [模式指南](agent-teams.md) |
| 发布与安装 | 上述代码已提交并推送；本轮文档任务不安装或发布 App | [提交](https://github.com/muzigef/zhixing/commit/60570bc3ecb53565a0fcdde1bced5315d69500fb) |

## 最近工程验证

2026-09-11 通用接入重构的本地验证：153 个文件 / 814 项测试通过，包含 lint、两端类型检查、integration、eval、mock smoke、敏感信息和 diff 检查。实际 macOS arm64 签名候选包七组 UI 通过；官方 Codex 离线协议和四项隔离检查通过。实包 `app.asar` SHA-256 为 `7f9354f0e452c1b1c525d2f493890ad133f561ec4f0776bee6df7ebe41a2eceb`。这是当次候选包证据，不是本轮文档更新后的重新打包。详见[架构验收](evidence/provider-architecture-20260911.md)。

**远端 CI 尚未全通过。** 对同一提交的 [GitHub Actions 34576546164](https://github.com/muzigef/zhixing/actions/runs/34576546164) 已完成：两套生产依赖审计及 `npm run verify` 成功；桌面 UI 的最后一组团队测试失败。日志定位为 `desktop/scripts/smoke-team.mjs:53`，“发送消息”按钮处于 disabled 状态，Playwright 点击等待 8 秒后超时。现有日志不足以判定是 UI 状态竞态还是测试等待问题；该项待复现与修复，不能仅增大超时或引用本机通过记录就宣称已解决。

本轮文档更新后重新执行 `CI=1 npm run verify`，退出码 0：153 个测试文件、814 项测试通过，另重跑 integration 9 项、eval 6 项及 mock smoke，两端类型检查、lint、敏感扫描和 diff 检查通过。后两组已包含于全量测试，不能相加成 829 个独立测试。本轮没有重跑桌面 UI 或真实模型；详细检查结果另记在[文档验收](evidence/documentation-refresh-20260911.md)，保留上一轮运行记录。

## 真实模型与质量

| 范围 | 最近证据 | 解释边界 |
| --- | --- | --- |
| 官方 Codex 订阅 | 重构后源码执行器通过固定短题，8.337 秒；版本 0.153.4 | 无 Pi；不是同一次实包真实 Codex 调用 |
| DeepSeek API | 实际签名候选包 IPC 调用成功，0.857 秒 | 使用已有安全存储；固定短题连通性 |
| Kimi API | 同一候选包 IPC 调用成功，16.539 秒 | 单次耗时不是长期分位数或 SLA |
| 预算优化对照 | 四道固定题合计 20 次运行完成且答案字段正确；同/异模型各 4/4 | 前一候选包；不是本次通用接入重构后重跑；不是 20 道独立题 |
| 复杂异模型任务 | H02 完成但耗时 228.6 秒；存在成员初答错误及定向纠正 | 小样本、近预算/时间上限，不证明稳定优势 |
| 教学效果 | 已实现学前/学后/延迟检查、作答来源、解释复核和汇总 | 真实学习者、独立复核和难度校准仍需数据 |

连接结果见[三家最小回归](evidence/provider-architecture-live-20260911.json)，质量结果见[预算优化](evidence/team-resource-budget-20260911.md)。更早的失败、32 题对照和 96 次运行继续保留，不将不同模型、题集、构建和评分口径混合计算提升比例。

## 接入能力

API 新厂商只要兼容已支持协议，就可通过配置接入；额外能力仍需声明与验证。官方 Codex 原生通道支持有界文本及团队；Claude Code 已有单 Agent 适配，但本轮未验证真实订阅；Gemini 原生执行未实现。其他厂商、SDK / App Server 按需扩展，不是当前必须逐家开通的欠交付。

API 工具执行与原生文本任务的能力不同。订阅由官方运行时管理认证，不提取账号令牌；订阅套餐也不自动提供 API 额度。Pi 兼容通道保留，源码默认桌面 Provider 仍为 `pi-codex`，已有用户设置可能不同。[配置说明](CONFIGURATION.md)给出实际选择方式。

## 已发现的入口一致性差异

共享内核策略已经统一，但 `src/cli.ts` 的 `execute()` 仍提前拒绝超过 8,000 字符的输入；共享 `agentSendSchema` 与桌面支持 20,000。这是入口输入限制不一致，并非把输入截断后发送。应补两端同输入边界测试并统一宿主策略；本轮只纠正文档，没有修改该行为。

## 当前待完成项

| 项目 | 所需工作或条件 |
| --- | --- |
| CLI/桌面输入上限 | 统一 CLI 8,000 与共享/桌面 20,000 的入口限制，补跨入口边界回归 |
| 最新远端团队 UI 失败 | 复现按钮禁用时序，分辨产品与测试问题，修复后通过同提交远端 CI |
| 更强的质量结论 | 更多独立任务、固定预算/模型/评分、重复运行、独立盲评；真实用户效果需实际参与者与延迟随访 |
| 最新安装交付 | 当前候选包未替换已安装 App；安装前核验来源、签名和目标应用。最近历史安装记录为 0.10.0，本轮没有读取本机安装元数据 |
| 正式分发 | 已有固定本地开发签名；Apple Developer ID、公证及正式发布验收仍另需对应证书和流程。本地证书不等同于正式公证 |
| 平台版本验证 | 0.9 有 Mac ARM/Intel 与 Windows 历史验收；本次 0.11 不能继承为所有平台实测通过 |
| 未来接入 | 其他官方订阅运行时、厂商能力和 SDK/App Server 有需求时独立实施和验证 |

当前没有云端多租户、分布式队列、高可用数据库、生产 SLO 实测或模型训练平台。这些可作为[系统设计练习](interview/system-design.md)讨论，不能写成项目既有成果。
