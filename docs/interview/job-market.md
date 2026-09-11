# Agent 开发工程师岗位要求与知行项目匹配

面向中高级 Agent 应用开发与架构岗位，最有说服力的项目材料应展示：如何把不稳定的模型输出变成可控的执行、如何定位失败，以及如何用评测证明改动有效。知行适合作为这类工程问题的讨论载体；它目前不是云端大规模生产服务，也没有真实教学收益的实证结论。

## 调研范围与证据口径

检索与核对日期为 **2026-09-11**。采用中英文搜索，覆盖企业官网、企业招聘系统及官方技术资料；下表整理 7 家机构的 11 个相关岗位样本，另检查字节 Seed、华为、小米等官方页面。招聘需求只根据能读取的原文或企业招聘页的搜索索引摘要概括；不是全市场普查，不据此估计岗位占比、薪资中位数或录用概率。

这是为项目准备的练习题，不是任何公司的泄露面试原题。岗位是否仍开放、地点及年限要求以投递时官网为准。百度样本属于校招/AIDU，不能把其中所有技术职责或其他海外社招年限当作统一门槛。搜索结果中的抓取时间也不等于岗位发布日期。完整链接及访问限制见[来源清单](sources.md)。

## 公开岗位样本

| 编号 | 机构 / 岗位 | 页面可确认的重点 | 知行适合展示什么 |
| --- | --- | --- | --- |
| J01 | OpenAI / Applied AI Engineer, Codex Core Agent | 工具、上下文、评测与真实失败分析；关注 solve rate、延迟和成本 | 分层失败归因、对照实验、预算与结果边界[^1] |
| J02 | OpenAI / AI Systems Engineer, Codex Agents | Agent harness、隔离、状态、编排、跨栈诊断与消融实验 | 内核/入口解耦、检查点、受限执行；GPU/分布式经验需另证[^2] |
| J03 | Anthropic / Applied AI Engineer, Enterprise Tech | Python 或 TypeScript、生产应用、Agent、评测、轨迹分析、MCP、客户沟通 | TS 共享内核、工具协议、把产品要求转为可验收契约[^3] |
| J04 | 百度 / 2027AIDU-Agent应用全栈工程师 J99974 | 规划/执行/反思、工具、记忆、状态、RAG、协作与效率评测 | 一次完整任务链、历史恢复与三模式取舍[^4] |
| J05 | 百度 / 智能体算法工程师 J101017 | 意图、多步规划、工具、长短记忆、多 Agent；效果/效率/成本一体评估 | 教学动作、团队任务图、指标口径；算法训练不是本项目成果[^5] |
| J06 | LangChain / Agent Reliability Engineer, GTM | Python/SQL、轨迹与日志、评测、SLO/分位数、业务收益及指标定义 | 不把单次首字当 p95，不把请求完成当质量通过[^6] |
| J07 | LangChain / AI Engineer, Enablement | 架构与评测取舍、Python 现场调试、客户教学与参考实现 | 项目源码演示、故障复盘及清晰技术表达[^7] |
| J08 | Scale AI / Frontier Agents Engineer, Applied AI | 检索/记忆/工具/多 Agent，离线与在线实验、人工评估、业务结果 | 测试与 eval 分层、团队公平对照；云实验能力需补充[^8] |
| J09 | Scale AI / Frontier Agents Engineer, Forward Deployed Engineering | 分布式系统、云基础设施、执行服务、容错、可观测性和企业集成 | 本地可靠机制与迁移到服务端的架构设计边界[^9] |
| J10 | General Intelligence Company / Applied AI Engineer - Agent | 行为/工具/记忆改进，离线回归、线上质量、重试幂等和审计 | 未知副作用处理、故障路径及版本化实验[^10] |
| J11 | Build Technologies / AI Engineer - Harness & Evals | runtime、retrieval、工具编排、tracing、恢复、质量循环 | 受控工具、上下文和可复现验证，而非只有聊天 UI[^11] |

J01–J05、J08–J09 的对应原文可读取；J06–J07、J10–J11 的企业招聘页索引可读，直接页面部分需要 JavaScript，因此不承诺职位仍在招。Scale 曾搜索到旧 Staff 岗位链接，但打开后跳转到岗位列表，已替换为列表中的可读职位；未把失效职位当成当前证据。

字节 Seed 官方页面可确认 Code Agent / 通用 Agent 算法岗位存在，但读取内容只有职位名称，不能据此补写技能要求。华为的官方岗位 22643 列出 Transformer、SFT、RAG、Agent 和场景落地，属于更广的 IT/AI 方案职责；小米官方人才页展示记忆评估和 Agent/OS 集成研究方向，二者均不混入上述应用工程岗位统计。腾讯详情超时、部分字节详情和阿里动态页未取得可核对原文，未依据转载编造官方要求。[^12][^13][^14]

## 应按岗位方向准备，而非把所有要求混成一份清单

| 方向 | 主要产出 | 面试准备重心 | 知行能提供的证据与缺口 |
| --- | --- | --- | --- |
| Agent 应用 / 全栈 | 可交付工作流和用户体验 | 状态、工具、RAG、评测、前后端边界 | 匹配度较高；需现场独立解释和修改实际代码 |
| Agent Runtime / 平台 | 可复用执行原语与可靠运行 | 隔离、并发、持久化、取消、恢复、资源预算 | 有本地实现；云端多租户、分布式一致性、生产运维未证明 |
| Applied AI / 算法应用 | 通过实验改进模型行为 | 假设、数据、失败归因、消融、评估设计 | 有真实小样本与失败记录；缺更大独立基准和外部评审 |
| Agent 训练 / 推理基础设施 | 模型能力、吞吐与训练效率 | SFT/RL、数据策略、GPU、推理引擎、分布式训练 | 当前不覆盖；不要把 API 调参写成微调或推理引擎优化 |
| Forward Deployed / 解决方案 | 企业业务集成和落地 | 需求澄清、方案取舍、部署、安全和沟通 | 教学产品适合说明需求到实现；缺真实企业部署与运营数据 |

以上分类是对所读岗位的分析归纳，企业内部职级并不统一。基础要求仍是扎实的软件工程能力：能写、测、调试代码，理解数据结构、异步、网络和数据库；模型框架经验应服务于这些能力，而不只是复述名称。

## 能力与项目证据映射

| 能力 | 应能回答的关键问题 | 项目入口 | 训练优先级 |
| --- | --- | --- | --- |
| 系统抽象 | 为什么拆 ModelClient 与 AgentExecutor？如何避免公共层堆厂商分支？ | [接入设计](../provider-architecture.md)、[工厂](../../src/agent-model-factory.ts) | 必须掌握 |
| Agent loop | 工具请求何时执行？非法/不完整流能否执行？如何判定完成？ | [模型调用](../../src/model-invocation.ts)、[ToolHarness](../../src/tool-harness.ts) | 必须掌握 |
| 上下文与记忆 | 长对话如何裁剪、摘要、保留纠正和工具配对？ | [记忆设计](../agent-memory.md)、[窗口](../../src/context-window.ts) | 必须掌握 |
| 数据检索 | 检索到片段为何不代表支持结论？如何分别测召回和回答？ | [资料库](../../src/library.ts)、[证据支持](../../src/evidence-support.ts) | 必须掌握 |
| 状态与可靠性 | 中断、重试、恢复和写入结果未知有什么区别？ | [连续性](../../src/task-continuity.ts)、[执行存储](../../src/agent-execution-store.ts) | 必须掌握 |
| 权限与安全 | prompt、schema、审批、沙箱各能防什么？ | [权限](../../src/agent-permissions.ts)、[项目工具](../../src/project-tools.ts) | 必须掌握 |
| 多 Agent | 分工、核查、纠错与综合如何防止错误传播？ | [协调器](../../src/team-coordinator.ts)、[任务图](../../src/team-task-graph.ts) | 必须掌握 |
| 预算与性能 | token 耗尽是否余额不足？首字为何不等于总延迟？ | [资源策略](../../src/team-resource-policy.ts)、[真实记录](../evidence/team-resource-budget-20260911.md) | 必须掌握 |
| 质量评估 | 814 测试、20 次运行和学习收益分别证明什么？ | [当前状态](../current-status.md)、[评测器](../../src/team-evaluation.ts) | 必须掌握 |
| 工程交付 | 本机测试过为什么 CI 会失败？如何定位输入状态竞态？ | [CI](../../.github/workflows/verify.yml)、[竞态复现与修复](../evidence/ci-44-team-ui-20260911.md) | 必须掌握 |
| 云端演进 | 本地单体变多租户服务，哪些约束必须重新设计？ | [系统设计练习](system-design.md) | 中高级重点 |
| 模型训练基础 | 何时选 RAG、提示、微调，如何避免训练/测试污染？ | [题库](question-bank.md)；训练实现不在本项目中 | 按目标岗位补充 |

## 最值得讲的项目故事

**通用接入。** 问题是厂商与账号类型不断增加。设计将逐轮 API 生成与官方 Agent 任务分开，同时共享会话和领域内核；同协议连接配置化、新运行时适配器化。表达重点是扩展契约、模型身份与失败边界，不是“十家全部打通”。

**团队不一定更好。** 历史评测出现过团队低于单模型、内部格式错误、连接失败和成员预算耗尽。调整实现后，固定小题集通过率改善，但题集、算力投入和评审方式限制了结论。可以展示失败记录怎样驱动假设和改动；不要宣称证明了通用团队优势。[原始范围与结果](../evidence/team-resource-budget-20260911.md)。

**长对话与恢复。** 原文保存、模型输入窗口和学习记忆有不同生命周期。说明如何保留工具配对和用户纠正，恢复为何必须检查授权和产物版本，以及为什么无法对未知外部写操作盲目重试。[设计](../agent-memory.md)。

**评价对象不同。** 代码测试通过、回答有解释、答案字段正确和学习者能迁移运用分别需要证据。知行有独立记录流程，但没有真实学习收益结果。这是可以讨论的实验设计能力，不应包装为已完成的教育效果研究。[研究协议](../teaching-study-protocol.md)。

## 准备顺序与交付物

下面是建议训练安排，不是已经完成的项目开发任务。

| 阶段 | 建议投入 | 必须产出 |
| --- | --- | --- |
| 1. 能讲清 | 2 天 | 90 秒与 5 分钟项目介绍、架构图、一条从输入到落盘的调用链 |
| 2. 能解释 | 3 天 | 核心题口述；每个答案至少指出一个源码入口、一项测试、一项限制 |
| 3. 能调试 | 3 天 | 对取消、工具结果未知、上下文裁剪、模型截断分别做最小复现；不得读取用户数据 |
| 4. 能比较 | 2 天 | 单 Agent/自检/同模型/异模型实验表，明确预算、公平性、指标和未验证项 |
| 5. 能设计 | 3 天 | 完成系统设计案例，写清需求、容量假设、失败状态与渐进迁移 |
| 6. 能接受追问 | 1 天 | 45–60 分钟模拟面试；记录薄弱项，重新读相关代码并修正表达 |

不要为“面试好看”重写整个项目引入热门框架。优先能够现场复现、定位、解释和做一个有测试的改动。如果目标岗位必须 Python，则用 Python 独立实现一个小型工具执行/评测任务作为练习，明确它不是本仓库主实现；TypeScript 经验不能伪装成 Python 生产经验。

## 自评规则

每题按 0–4 分自评：0 是答错或无法解释；1 是只会定义；2 是能说出方案；3 是能指向本项目源码和失败测试；4 是能比较替代方案、量化验证并准确说明边界。该评分是学习工具，不是公司录用标准。

至少准备三个可追问的失败案例。被问到“是不是 AI 帮你写的”时，如实说明使用方式、自己负责的决策与验证；现场用代码和推导证明理解，而不声称未经证实的独立贡献、用户规模或业务增长。

## 参考来源

[^1]: OpenAI, [Applied AI Engineer, Codex Core Agent](https://openai.com/careers/applied-ai-engineer-codex-core-agent-san-francisco/)，访问 2026-09-11，页面未注明发布日期。
[^2]: OpenAI, [AI Systems Engineer, Codex Agents](https://openai.com/careers/ai-systems-engineer-codex-agents-san-francisco/)，访问 2026-09-11。
[^3]: Anthropic, [Applied AI Engineer, Enterprise Tech](https://job-boards.greenhouse.io/anthropic/jobs/5057647008)，访问 2026-09-11。
[^4]: 百度, [AIDU 校园岗位列表，J99974](https://talent.baidu.com/jobs/list?projectType=3&recruitType=GRADUATE)，职位标注 2026-07-21，访问 2026-09-11。
[^5]: 百度, [校园岗位列表，J101017](https://talent.baidu.com/jobs/list?projectType=1)，职位标注 2026-07-21，访问 2026-09-11。
[^6]: LangChain, [Agent Reliability Engineer, GTM](https://jobs.ashbyhq.com/langchain/eadd2a71-47fc-483b-948f-4b2384f7f93f)，访问 2026-09-11，采用企业页搜索索引，直接页正文受 JavaScript 限制。
[^7]: LangChain, [AI Engineer, Enablement](https://jobs.ashbyhq.com/langchain/b8dead31-212a-4b92-82a7-c42df16ae877)，检索 2026-09-11，采用企业页索引。
[^8]: Scale AI, [Frontier Agents Engineer, Applied AI](https://job-boards.greenhouse.io/scaleai/jobs/4720573005)，访问 2026-09-11，从当日岗位列表进入。
[^9]: Scale AI, [Frontier Agents Engineer, Forward Deployed Engineering](https://job-boards.greenhouse.io/scaleai/jobs/4694861005)，访问 2026-09-11。
[^10]: General Intelligence Company, [Applied AI Engineer - Agent](https://jobs.ashbyhq.com/generalintelligencecompany/4bc5d479-3bba-432d-887f-423847aa650a)，检索 2026-09-11，采用企业页索引。
[^11]: Build Technologies, [AI Engineer - Harness & Evals](https://jobs.ashbyhq.com/build/cdf0c29b-157e-4b85-a767-e72211022c96/)，检索 2026-09-11，采用企业页索引。
[^12]: 字节跳动 Seed, [加入我们](https://seed.bytedance.com/zh/career)，访问 2026-09-11，仅职位名称与地点可读。
[^13]: 华为, [社会招聘岗位 22643](https://career.huawei.com/reccampportal/portal5/social-recruitment-detail.html?dataSource=1&jobId=22643)，访问 2026-09-11，正文可读，标题未在提取内容中明确显示。
[^14]: 小米, [全球顶尖人才](https://hr.xiaomi.com/website/top-talent.html)，检索 2026-09-11，属于研究方向，不是单独岗位 JD。
