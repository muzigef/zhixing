# 项目文档导航

第一次了解项目先读根目录 [README](../README.md) 和 [Agent 设计说明](agent-design.md)。判断“现在做到了什么、验证过什么、还有什么问题”请读[当前状态](current-status.md)；它区分源码、候选包、历史安装、真实模型质量和远端 CI。

## 使用与开发

| 目的 | 文档 |
| --- | --- |
| 开始运行 | [快速开始](GETTING-STARTED.md)、[桌面指南](../desktop/README.md) |
| 配置模型与预算 | [配置](CONFIGURATION.md)、[三种模式](agent-teams.md) |
| 使用命令 | [CLI 参考](CLI-REFERENCE.md) |
| 开发与验证 | [开发](DEVELOPMENT.md)、[测试](TESTING.md)、[贡献](../CONTRIBUTING.md) |
| 安全与授权 | [安全](../SECURITY.md)、[会话权限](session-permissions.md)、[本地签名](macos-local-signing.md) |
| 排查故障 | [故障处理](TROUBLESHOOTING.md)、[当前待办](implementation-backlog.md) |
| 准备面试 | [面试资料入口](interview/README.md)、[岗位调研](interview/job-market.md) |

## 设计与核心模块

| 领域 | 文档 |
| --- | --- |
| 全局架构 | [架构](architecture.md)、[源码导读](agent-code-walkthrough.md)、[设计决策](decisions.md) |
| 共享执行内核 | [内核](agent-kernel.md)、[数据与质量](data-and-quality-spec.md) |
| 模型接入 | [通用架构](provider-architecture.md) |
| 记忆与上下文 | [记忆模型](agent-memory.md)、[模型上下文](model-context.md) |
| 团队 | [团队内核](agent-team-kernel.md)、[三模式配置](agent-teams.md) |
| 外部能力 | [MCP](mcp-tools.md)、[Pi 约束](pi-constraints.md)、[图片](image-input.md) |
| 实践与执行 | [实践项目](practice-projects.md)、[项目修订](project-revisions.md)、[统一执行沙箱](execution-sandbox.md) |
| 教学与证据 | [教学策略](teaching-policy.md)、[证据支持](evidence-support.md)、[学习结果](learning-outcomes.md) |
| 质量与研究 | [Agent 质量评测](agent-quality-evaluation.md)、[教学研究](teaching-study-protocol.md) |
| 功能与验收对应 | [功能矩阵](features-and-acceptance.md) |

## 历史与证据

[证据索引](evidence/README.md)按运行解释测试、质量和平台结果；[TASKS](../TASKS.md)保留历次任务；[CHANGELOG](../CHANGELOG.md)记录版本演进。带版本号或日期的计划/研究文档保留原始范围和当时结论，不是当前欠缺功能的清单。

完整逐文件清单与核查方式见[文档清单](documentation-inventory.md)。历史文件中的旧模型名、测试数、超时和安装路径是当时事实；改为当前数值会破坏实验可追溯性。历史源码链接发生移动时修正导航并保留解释，不修改原始结果 JSON。

## 维护规则

- 行为改动同时更新相应指南和模块文档；版本、默认值与能力必须查实际契约和注入点。
- 当前状态有唯一汇总入口，历史验收有不可替代的时间、模型、构建和评分条件。
- 新验证追加独立记录；本地通过、远端 CI、真实账户、模型质量和用户效果不能互相替代。
- 代码路径、命令、Markdown 链接及锚点应可执行或可定位；无法验证的外部网页明确访问限制。
- 本项目 [AGENTS.md](../AGENTS.md) 是仓库开发指令，[Agent 设计说明](agent-design.md) 是普通架构文档，[runtime-AGENTS.md](../desktop/runtime-AGENTS.md) 是独立的桌面运行时指令源；内附教学 Skill 和 Topic Plan 是课程资源，不把文档索引自动当模型授权。

- [分层 RAG 开发评测](rag-evaluation.md)：检索/固定证据/端到端分离，真实 Codex 与哈希绑定评分入口。

- [四组扩展开发评测](team-evaluation-expanded.md)、[解释三维评分](explanation-quality-review.md)、[盲评与校准](blind-review-workflow.md)：区分机器字段分、解释质量、独立评分和真实教学效果。

- [评测设计冻结与消融](evaluation-design.md)：记录曝光、运行条件、评分标准及单因素比较的边界。

- [模型性能基准](provider-performance.md)：新建/复用客户端、首正文与完整消息、P50/P95 和失败分母。

- [教学验收材料就绪检查](teaching-readiness.md)：迁移、延迟、独立复核及材料不足报告。

- [教学研究冻结与随机分组](teaching-study-design.md)：封闭名单、分组文件、意向性分母和缺失上下界。

- [平台安全存储与原生验收](native-secure-storage.md)：系统后端选择、拒绝明文回退和进程重启探针。

- [正式发行门禁](formal-release-gate.md)：实包、原生存储、发行内容、签名与公证的完整回执链路。

- [模型能力声明与实测](provider-capability-evidence.md)：文本/工具往返、服务端模型标识与官方运行时版本。
- [团队预算核算](team-budget-accounting.md)：逐请求预留、未知用量、误差校准与非硬限额边界。
- [派生产物依赖](derived-artifact-dependencies.md)：摘要、OCR/切块、语义向量和构建来源的版本失效。
- [外部操作恢复](external-operation-recovery.md)：宿主操作身份、服务幂等约定和请求绑定核验。
- [外部资源版本观测](external-resource-observations.md)：配置的版本回执与持久防循环状态。
- [恢复故障注入矩阵](recovery-fault-matrix.md)：跨 SQLite/文件、预算、取消、备份与防降级。
