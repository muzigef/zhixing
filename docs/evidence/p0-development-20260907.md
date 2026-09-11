# 三项 Agent P0 开发验收

> 历史验收快照：下文的测试数量、失败、安装及“待验”状态仅适用于记录当次执行；未重新运行或改写历史结果。当前实现与后续进展见 [当前状态](../current-status.md) 和 [证据索引](README.md)。

2026-09-07。范围依据用户“开启开发任务，保证 3 个 P0 全部完成”，对应[冻结标准](../p0-agent-kernel-plan.md)。原[专项核验](p0-verification-20260907.md)保留为修改前证据，不改写其 4 项未满足结论。

## 实现与对应证据

| 目标 | 已实现行为 | 主要验证 |
| --- | --- | --- |
| 共用 Headless 会话服务 | Electron 的 DesktopService 为 AgentService 兼容导出；CLI 的聊天、教学回答、工具任务使用同一服务。自然对话生成中的队列与纠正持久保存，任务身份保留；课程状态仍由学习领域服务控制 | agent-service、agent-cli-lifecycle、interaction-cli、desktop-tasks |
| 执行检查点与恢复 | 完整校验后保存工具批次、callId、输入、游标和实际结果；审批和问答接回原生工具链；会话/任务进程租约阻止并发覆盖；不确定且不可安全重试的操作停止 | agent-checkpoint、agent-crash、desktop-interactions、双 Provider 协议及真实调用 |
| 执行→验证→修复 | 同参数测试在真实产物修改后允许重跑；本轮无进展循环停止；计划未完成时继续，连续无进展则 blocked；取得实际进展重置检查计数 | agent-p0-execution、原八项专项脚本、blocked UI 重试 |

附带完成 CLI 新会话强杀恢复入口、v1/v2 到 v3 的保存前备份、未来版本拒绝、完整备份包含 CLI 会话、恢复后清除授权/租约、原卡片兼容及 Provider 私有状态不落盘。CLI 旧 6 轮历史继续作为兼容投影。已保留原 README 和学习效果文档变更。

## 已执行验证

- 项目依赖：根目录和 desktop 分别 `npm ci --no-audit --no-fund`，无依赖版本变更。
- 按切片运行完整 `npm run verify`：A 为 80 文件/362 测试，B 为 81/365，共享服务接入后为 82/366；随后回归达 84/382，均退出 0。
- `node --import tsx scripts/audit-agent-p0.ts`：8 项全部满足，退出 0。审批恢复新 stream 为 0、原生 continue 为 1、history 为 1；纠正前后 taskId 相同且操作数均为 1；修复流程真实测试两次，首次 exit 1、修复后 exit 0。
- 真实进程 SIGKILL：工具批次刚验证、产物已写入但操作结果未提交、第一项工具结果已保存，三处恢复均只保存预期两份产物，均从原批次继续。另有首次 CLI 对话强杀后从原 taskId 恢复测试。
- `npm --prefix desktop run test:ui`：四组均退出 0；覆盖真实 Electron 流式/数学、学习数据与本地实验、排队/纠正、交互与备份、学习效果流程；新增 blocked 展示与同任务重试。
- v3 定向迁移/存储/CLI/备份验证：9 项通过。最终完整验证见下方补记。

## 双 Provider 合成验收

通过正式 PiApplicationClient / DeepSeekClient，只发送临时合成代码 `export const answer = 42;`。请求写入 → 审批暂停 → 新建服务与客户端 → 原生工具结果续接 → 核对实际产物 1 份。凭据完全交由既有 Provider 和安全存储接口使用。

首轮[结构化记录](p0-live-20260907.json)：Pi Codex / gpt-5.6-terra 9,065 ms；DeepSeek / deepseek-v4-flash 1,971 ms。均为 1 次初始请求、1 次原生续接、1 轮恢复历史、1 个对应结果、同一 taskId。时间包含整个合成审批流程，只有各一次样本，不能解释为延迟分位数。

## 限制

这次验收证明上述三项具体合同，不代表达到商业 Agent 的整体任务成功率或教学效果。真实学习者效果、Windows/Intel 实机、签名公证和新安装包未在本次验收；未执行 Git 提交或推送。原网络连接不能复活，恢复会从已保存边界发起新请求；强杀可能丢失约 750 ms 内未保存文字。执行仍遵守有限轮次、存储和上下文预算。

## 最终补记

最终 v3 代码：`npm run verify` 退出 0，84 文件 / 383 测试全部通过，含两套类型检查、lint、integration 9 项、eval 6 项、mock smoke、敏感扫描和 diff 检查。四组 Electron UI 全部退出 0；八项专项再次全部满足。

[最终真实记录](p0-live-final-20260907.json)：Pi Codex / gpt-5.6-terra 10,153 ms，DeepSeek / deepseek-v4-flash 1,632 ms。各 1 次初始请求、1 次原生续接，原 callId 结果与 taskId 保留，实际产物各 1 份。此次直接检查 SQLite 检查点仅包含规范文本/工具事件，未保存 Provider 私有状态。

本轮三个 P0 均按冻结标准完成。README、架构、CLI 参考、代码讲解、桌面使用与测试指南已同步；未对历史验收结论做追溯改写。

## 再次复核修正

用户要求深入复核后，新增反例发现跨入口写入、审批恢复/身份、计划要求和旧测试结果的五类遗漏。上文是首轮实际验证记录，383 个测试未覆盖这些边界，不能据此断言质量收口。发现、修复和最新结果见[再次深入复核](p0-reaudit-20260907.md)。
