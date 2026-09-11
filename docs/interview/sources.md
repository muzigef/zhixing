# 面试调研来源与使用边界

统一访问/检索日期：2026-09-11。岗位来源是招聘要求的依据；技术来源支持原理与设计，不证明知行已经实现对应产品的所有能力。未标注发布日期的网页不凭抓取日期补写发布日期。

## 招聘来源

[岗位分析](job-market.md)的 J01–J11 与编号脚注一一对应。完整链接、机构、日期和正文可读性均在该文末列出。采用 7 家机构、11 个岗位样本；同一机构多个岗位不视作独立的市场占比样本。

- 官方正文：OpenAI 两个岗位、Anthropic Enterprise Tech、百度两个编号岗位、Scale 两个岗位。
- 企业招聘系统索引：LangChain 两个岗位、General Intelligence Company、Build Technologies。直接页面部分无正文，不把搜索索引视为实时职位开放保证。
- 方向补充：字节 Seed 仅岗位名，华为 22643 为更广 IT/AI 职责，小米为研究课题；未冒充细化的 Agent 应用岗要求。
- 未采纳为要求证据：腾讯详情超时；部分字节详情不可读；阿里动态招聘未取得原文；NVIDIA 详情未提取到完整职责；Cohere 同 ID 出现标题变化且正文不可读。转载、论坛面经、培训广告只作为发现线索，未作为技术或招聘结论的权威依据。

搜索覆盖 Agent / Applied AI / AI Systems / Frontier Agents / Agent Reliability / Agent应用全栈 / 智能体算法等名称。该覆盖仍有语言、地区、网页可访问性及头部企业偏差。应在获得具体 JD 后用其必选/优选要求重新排序题库。

## 技术来源

以下八个公开技术来源均已实际打开并读取相关正文；题库在使用处就近链接。日期表示原文首次发布或规范版本，未提供明确日期的页面标为“未标注”。`main` / `latest` 文档会变化，不等同于项目锁定的依赖版本。

| 来源 | 发布日期 / 版本 | 用于题目与论点 |
| --- | --- | --- |
| Anthropic：[Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) | 2024-12-19 | Q01：固定工作流与自主 Agent 的区别、从简单方案开始 |
| Vaswani 等：[Attention Is All You Need](https://arxiv.org/abs/1706.03762) | 2017-06-12；修订 2023-08-02 | Q02：Transformer 与注意力的原理背景 |
| Hugging Face：[Generation](https://huggingface.co/docs/transformers/main/en/main_classes/text_generation) | 未标注；`main` 文档 | Q02/Q04：缓存、temperature、top-p 等生成参数 |
| Lewis 等：[Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks](https://arxiv.org/abs/2005.11401) | 2020-05-22；修订 2021-04-12 | Q06：将外部检索与生成结合；不证明项目采用论文中的训练方法 |
| MCP：[Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools) | 规范版本 2025-11-25 | Q27/Q48：协议错误、工具执行错误与宿主验证责任 |
| Anthropic：[Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) | 2026-01-09 | Q49：评估轨迹、最终环境状态和任务结果 |
| SQLite：[Atomic Commit In SQLite](https://sqlite.org/atomiccommit.html) | 未标注 | Q43：数据库事务原子性及其对外部副作用的适用边界 |
| Electron：[Security](https://www.electronjs.org/docs/latest/tutorial/security) | 未标注；`latest` 文档 | Q46：渲染进程隔离、IPC 与主进程权限边界 |

另通过 GitHub CLI 读取本项目 [Actions 运行 34576546164](https://github.com/muzigef/zhixing/actions/runs/34576546164) 的实时状态与失败日志，用于 Q49 的工程验收案例；这是仓库运行证据，不属于外部技术原理或招聘样本。

## 项目事实来源

| 事实 | 权威入口 | 使用限制 |
| --- | --- | --- |
| 代码与版本 | [当前状态](../current-status.md)、[根包](../../package.json)、[桌面包](../../desktop/package.json) | 源码版本不等于安装版本 |
| 执行与上下文 | [架构](../architecture.md)、[记忆](../agent-memory.md)、[源码导读](../agent-code-walkthrough.md) | 引用具体实现，不由设计愿望推断 |
| 模型接入 | [架构契约](../provider-architecture.md)、[三家验收](../evidence/provider-architecture-20260911.md) | 模板/接口可扩展不等于十家都实测 |
| 团队 | [内核](../agent-team-kernel.md)、[资源预算原始记录](../evidence/team-resource-budget-20260911.md) | 固定四题20次运行不是20道独立题 |
| 学习效果 | [协议](../teaching-study-protocol.md)、[结果模型](../learning-outcomes.md) | 没有真实参与者收益结论 |
| CI | [运行34576546164](https://github.com/muzigef/zhixing/actions/runs/34576546164) | verify成功、团队UI失败；不能简化为全部通过 |

技术题中的外部论文和官方规范，在对应题目附近直接链接。它们提供可迁移原理，项目映射仍必须由仓库源码与测试支持。建议复习时记录读过的源码、自己完成的实验与仍不确定之处，避免将资料作者的设计或建议写成个人已交付成果。
