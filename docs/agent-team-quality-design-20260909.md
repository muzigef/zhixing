# 团队协作质量优化

> 历史计划或版本记录：下文保留当时的设计、范围及验证结果，不是当前功能清单或新的开发指令。现行实现、已完成的后续改动与待验收项见 [当前状态](current-status.md) 和 [文档导航](README.md)。

用户目标：参考优秀同模型和异模型协作方式，改进知行并完成工程与真实模型验证。单 Agent 默认、共享 AgentService、已有授权边界和用户选择的模型均保留。

## 研究依据与设计选择

查阅日期：2026-09-09。没有跨任务统一的“最优秀”架构，以下是有官方工程依据或公开评测的模式；不将历史论文模型的成绩外推为当前三家模型的收益。

| 来源 | 可复用机制 | 知行中的采用方式 |
| --- | --- | --- |
| [Codex 官方子 Agent 文档](https://learn.chatgpt.com/docs/agent-configuration/subagents) | 有界职责、独立上下文、精炼结果、按角色配置模型与推理 | 保留隔离与固定绑定，成员返回有 schema 的结论、核查依据和不确定性；允许显式成员推理设置 |
| [Anthropic Research](https://www.anthropic.com/engineering/multi-agent-research-system) | 主 Agent 按问题分工，明确目标、输出与边界，依据发现继续调查 | 分工明确不同验证方法；由主模型对成员结果做一次独立审查，必要时追加一次定向核查 |
| [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams) | 独立工作、互相质疑、协调状态可见，适合可并行任务 | 首轮不暴露同伴意见，后续只传递有界的同伴核查数据；不引入无限聊天与递归委派 |
| [Mixture-of-Agents 论文](https://arxiv.org/abs/2406.04692) | 不同模型先独立提出结果，再利用上一层结果聚合 | 同模型强调方法独立，异模型强调证据互补；综合时不按票数或品牌决定正确性 |
| [Anthropic evaluator–optimizer](https://www.anthropic.com/engineering/building-effective-agents) | 明确标准下评估并定向改进，使用环境证据 | 结构化分歧清单与有界复核，不把模型审查通过等同于正确性认证 |

## 可验收切片

1. 基础缺陷：输入资料数量不再误判输出段数；失败请求保留已报告用量，区分输出截断原因。已完成失败测试与回归；`npm run verify` 通过，日志 `/tmp/zhixing-team-quality-slice1-verify.log`。
2. 协作协议：结构化成员报告、独立审查、条件复核、错误分类、预算与恢复、桌面和 CLI 可见性。完整 verify 与七组桌面 UI 均通过；日志 `/tmp/zhixing-team-quality-slice2-verify.log`、`/tmp/zhixing-team-quality-ui.log`。
3. 新评测：旧题两轮回归已保留，新增题与协议已冻结。32 个新题任务及逐条解释复核已完成；内部协议补修后 723 项门禁及七组实包隔离 UI 通过，最新包原生授权和旧题回归仍待收口。见[当前验收记录](evidence/team-quality-optimization-20260910.md)。

## 约束与验收标准

- 总请求与 token 仍受共享预算限制，审查/复核不能挤占最终回答最低容量；取消必须传播，恢复不自动重发不确定请求。
- 成员结果只作为待核查数据。结构通过不等于事实正确；不得从一致意见推断工具已经运行。
- 默认不共享历史。审查产生的跨成员问题只能使用本轮问题及成员结果，不得泄露主会话私有上下文。
- 单成员失败与最终回答质量分别报告；不放宽评分器、删除失败或把未知用量补零。
- 真实评测只使用合成资料与产品内受控 Provider，不读取或导出凭据。
- 工程验收包括相关失败/边界测试、完整 verify 和桌面 UI；真实回答评测不替代真实学生学习效果试验。

## 回归发现与冻结前修正

首轮回归保留在 `docs/evidence/team-evaluation-regression-20260909155415472.json`，并非新留出成绩：H02/H04 各四组，普通 Pi、自检 Pi、同模型均 2/2 完整且正确，异模型 1/2。H02 DeepSeek 返回 length 并报告 4095 输出 token，Kimi 在适配器 150 秒时限失败；不能归咎于缺少授权。H02 同模型审查发现成员 order 遗漏 H，定向复核仍有字段与解释不一致，但主模型最终采用正确结果，说明复核意见同样需要审查。

据此在新留出前调整自动档：主模型仍 balanced，Pi 成员 balanced，内置 DeepSeek/Kimi 成员 quick；不提高整题预算，显式设置与恢复任务的原绑定优先。这是待评测的有界执行选择，并非断言较少推理总能提升质量。官方参数依据：[DeepSeek 思考控制](https://api-docs.deepseek.com/guides/thinking_mode/)、[Kimi K3 官方用法](https://github.com/MoonshotAI/Kimi-K3#6-model-usage)。后者始终思考，quick 请求 low，不等于关闭思考。

新团队复核记录使用会话 v10，保存时保留旧格式副本；旧 v9 仍可读取，禁止较旧会话对象覆盖新版。覆盖分段历史和恢复中的复核状态。桌面准备期间的取消纳入共享 AgentService，避免设置读盘发生在可取消流程之外。
