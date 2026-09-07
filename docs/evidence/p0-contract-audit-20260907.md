# 三项 P0：排队、取消、纠正与执行进展的再核查

2026-09-07，用户再次要求深度确认。基线是[上一轮 391 项测试的复核](p0-reaudit-20260907.md)，仍使用原[冻结标准](../p0-agent-kernel-plan.md)，没有重新定义三项 P0。

## 发现与处理

本次新增反例又复现了范围内的遗漏，因此不能把上一轮“全部高质量完成”理解为没有剩余缺陷。

| 对应 P0 | 复现问题 | 已实施修复 |
| --- | --- | --- |
| P0-1 / P0-2 | 排队请求只保存文本和模型参数，丢失 execution/contextAllowed；停止并重启后，即使排队时选择只读或不使用学习上下文，也会按旧授权保存产物 | 共享队列持久保存主题、上下文和执行权限，并原样传入 send；桌面入队路径同步携带这些选项，一次授权不会自动延续到下一次排队 |
| P0-1 / P0-2 | CLI 续接 application 任务时走另一个适配分支，没有连接调用方 AbortSignal，且 interrupted 未按取消返回 | 恢复分支连接同一停止入口并清理监听；取消返回 AbortError，保留 interrupted 和原 taskId |
| P0-2 | 用户调整任务后，原工具批次里尚未执行的调用先于新要求被分发 | 以持久 steerId 记录纠正意图和已处理状态；保留原真实结果，将未开始的旧调用返回为 tool_superseded，不执行；执行中结果未知则明确标注 unknown，不伪造成功。不可安全重试的未知操作仍拒绝自动推进 |
| P0-3 | LoopGuard 只把保存产物视为进展，测试真正通过后再查询状态会被误拦 | 已完成的实际测试操作也更新执行状态，重复状态查询能观察新的真实结果 |
| P0-3 | 在同一个已验证批次中依次测试、修改、同参数重测，循环检查提前按批次初始状态拒绝整个批次 | 协议依然先完整校验；重复检查移动到每次实际分发之前，按当前状态判断；每项工具结果保存分发时状态，供恢复时重建循环记录 |

纠正仍保留 taskId、已保存结果和原生调用对应关系。相同 steerId 不会在重启后再次取消纠正后新产生的工作；旧交互卡根据持久取消结果同步关闭。原计划完成要求仍由应用检查，纠正输入不自动授予模型删除验收条件的能力。

## 实际验证

- 先写失败回归：排队只读/上下文限制各实际产生 1 份不应保存的产物；CLI 取消仍返回成功；旧待执行调用未被纠正拦截；测试成功后的状态查询失败；同批次修复重测失败。修复后均通过。
- 定向 `npx vitest run tests/agent-p0-execution.test.ts tests/agent-contract-edges.test.ts tests/agent-checkpoint.test.ts tests/agent-crash.test.ts tests/model-invocation.test.ts tests/agent-limits.test.ts tests/pi-latency.test.ts tests/deepseek-client.test.ts`：8 文件 / 68 测试，退出 0。随后另扩展不可安全重试操作的纠正路径检查。
- 最终 `npm run verify`：退出 0，**85 文件 / 400 测试**；lint、两套类型检查、integration 9 项、eval 6 项、mock smoke、敏感扫描和 diff 检查全部通过。
- `node --import tsx scripts/audit-agent-p0.ts`：退出 0，原 8/8 全部通过，实际本地实验首次 exit 1、修复重测 exit 0，包含实际 SIGKILL 与产物恢复。
- `npm --prefix desktop run test:ui`：退出 0，四组 Electron UI 全部通过。增强断言核对真实入队请求中的 execution/contextAllowed/topicId，以及立即调整的持久 steerId 和相同 taskId。
- `node --import tsx scripts/verify-p0-live.ts --live --output=docs/evidence/p0-live-contract-audit-20260907.json`：退出 0。Pi Codex / gpt-5.6-terra 16,064 ms，DeepSeek / deepseek-v4-flash 1,530 ms；各 1 次初始请求、1 次原生续接、1 份实际产物，同一 taskId，未保存 Provider 私有状态。[结构化记录](p0-live-contract-audit-20260907.json)。仅使用既有 Provider 接口与临时合成代码；各一次样本不构成延迟基准。

## 结论范围

目前能确认三项 P0 的实现和本次验收通过，所有本次复现的问题均已修复。不能用测试数量证明零缺陷或给出无条件的“全部高质量”保证；验证范围以这些可执行断言、真实入口和故障场景为准。

相对于上轮增加 9 项自动化用例，并增强 Electron 入队权限与纠正身份断言。文档链接和敏感信息检查通过；README、任务清单、冻结计划及内核说明已指向本次证据。

本次未执行 Windows/Intel 实机、新安装包、签名公证、开放任务成功率或真实学习者教学效果验收；没有 Git 提交或推送。真实模型短流程不能替代长期稳定性或教学效果评价。

用户随后要求继续核实，新增反例发现事件订阅、恢复预算、取消后的重复判断以及异步完成核验的边界遗漏。上文保留为当轮 400 项测试及真实 Provider 的实际记录；后续修复与当前结论见[恢复边界核查](p0-recovery-audit-20260907.md)。
