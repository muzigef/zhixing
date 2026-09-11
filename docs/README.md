# 项目文档导航

第一次了解项目先读根目录 [README](../README.md) 和 [agent.md](../agent.md)。判断“现在做到了什么、验证过什么、还有什么问题”请读[当前状态](current-status.md)；它区分源码、候选包、历史安装、真实模型质量和远端 CI。

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
| 实践与执行 | [实践项目](practice-projects.md)、[项目修订](project-revisions.md) |
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
- 本项目 `AGENTS.md` 是协作规则，`agent.md` 是设计导航；内附教学 Skill 和 Topic Plan 是课程资源，不把文档索引自动当模型授权。
