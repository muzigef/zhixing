# Agent 核心审查与修复

日期：2026-09-05。范围：知行现有学习产品的执行、Provider、工具、主题隔离、教学会话和验证链路。

## 结论

原实现有较完整的学习命令与状态机，但真实 Provider 主要输出文本，工具循环只有测试级适配；若只看既有 133 个测试通过，会漏掉取消后执行、断流假成功、伪造工具结果、会话串题和符号链接越界等问题。本次已补失败测试和运行时修复，并将只读学习工具实际接到 DeepSeek 和 CLI。

这次对齐的是主流 agent 的核心执行能力，并不代表知行已经拥有完整编程 agent 的全部功能。Codex 的官方说明包括本地读写代码、命令执行、会话恢复与扩展；Claude Code 说明了收集上下文、执行、验证的循环及会话管理。这里据此选择可在现有主题和隐私边界内落地的能力。[Codex CLI](https://learn.chatgpt.com/docs/codex/cli)、[Claude Code 工作机制](https://code.claude.com/docs/en/how-claude-code-works)。

## 已处理问题

| 级别 | 原问题与影响 | 修复及验证边界 |
| --- | --- | --- |
| P0 | 已取消的 ToolHarness 调用仍先执行函数，可能产生写入 | 先检查取消，再校验和执行；取消后执行次数为零 |
| P0 | schema 剥离 topicId，控制面未拒绝跨主题参数 | 在 schema 解析前拒绝跨主题；学习工具不接收任意主题或文件路径 |
| P0 | Provider 可以凭 tool_result 事件伪造工具成功；done 后还能执行工具 | 只接纳受控回调结果，done 为终止边界，完整批次校验后才 dispatch |
| P0 | 只校验主题目录，父目录和叶子符号链接可以越界 | PathPolicy 遍历受信根以下所有现存路径组件；含父目录、嵌套目录和文件回归 |
| P1 | 真实模型不接收工具 schema，不能消费工具结果继续工作 | DeepSeek 传递 schema、call ID 和完整历史；新增学习助手真实 CLI 入口 |
| P1 | SSE 不识别 CRLF；DONE 后还等待连接关闭；坏帧和 EOF 被当成功 | 增量 CRLF/UTF-8 解析，DONE 主动结束，协议错误和不完整流明确失败 |
| P1 | 流读取不响应超时，单轮可无限输出或请求大量不同工具 | 可取消等待覆盖 Provider 与工具；总时限、轮次、调用数、事件数和字符预算 |
| P1 | 真实 Provider 输出一半后拼接 Mock，并记录成功 | 只有尚未产生事件时允许既有 fallback；部分输出明确未完成，审计记 error |
| P1 | 初始审计写入失败留下永久占用的前台槽 | start 位于 try/finally 保护内；错误后可以启动下一 Run |
| P1 | 账本保存原始异常，可能写入用户内容；AbortError 状态不一致 | 持久化已知错误码，未知错误归 operation_failed；审计和账本统一 cancelled |
| P1 | 长讲解超过 8,000 字符导致检查点保存失败；加载未校验 topicId | 有标记截断并原子保存；拒绝属于别的主题的检查点 |
| P1 | 答疑/参考答案覆盖原题，每次交互都增加测验计数；生成失败也先改阶段 | 成功出新题后才转移；保留原题和原有 20 轮上限；部分回答不提交教学进展 |
| P1 | 切换主题保留旧对话/待确认草案，内存对话无限增长 | 切换时清空，内存保留至多 12 条、每条至多 8,000 字符 |
| P2 | 重排 JSON 字段能绕过重复检测；void 工具结果被误判为失败 | 递归规范化字段顺序；undefined 结果统一为 null |
| P2 | mock smoke 默认打开真实用户数据库；harness 脚本没跑核心工具测试 | smoke 使用临时根并禁用真实 Provider；harness 包含运行时、协议和 CLI 测试 |

DeepSeek 适配按官方工具调用与 Chat Completions 协议实现；默认模型改为当前文档列出的 `deepseek-v4-flash`，可通过 `ZHIXING_DEEPSEEK_MODEL` 覆盖。当前明确使用非 thinking 模式，不声称支持 reasoning transcript 续写。[工具调用](https://api-docs.deepseek.com/guides/tool_calls/)、[API 参考](https://api-docs.deepseek.com/api/create-chat-completion/)。

## 使用与权限

已配置 DeepSeek 后，在 REPL 输入：

```text
模型切换 tutor deepseek-api --确认
学习助手 根据我的进度建议下一步
学习助手 结合已导入资料解释 RAG 的引用机制 --允许外发
```

对应 headless 命令：

```bash
npm run start -- '学习助手 解释 RAG --允许外发' --topic rag
```

默认仅开放 `learning_progress` 和 `list_materials`；本次命令有正文外发许可才注册 `search_materials`。正文检索每次最多 3 条，每条最多 2,000 字符，并保留引用位置。仅查询当前主题；写操作仍须由既有命令控制面授权，模型不能提升 maxRisk。模型选错工具时会收到结构化错误并可调整下一步。

每次调用最多 6 个模型回合、32 次工具请求、10,000 个事件、64,000 字符输出、128,000 字符上下文估算、180 秒；工具结果单次最多 12,000 字符。超过限制停止，不自动扩容。DeepSeek HTTP/流每次仍为 60 秒。

## 与主流 agent 的能力差距

| 能力 | 本次后知行状态 | 后续边界 |
| --- | --- | --- |
| 模型驱动的工具循环 | DeepSeek + CLI 实际可用，完整历史与错误反馈 | 当前只提供学习领域读工具 |
| 工具权限与取消 | schema、主题、风险、取消、截止时间、限额由代码执行 | 不能强制撤销忽略 signal 的任意 JS 副作用；写工具仍需独立 OS/进程隔离 |
| 上下文管理 | 字符预算、有限转录、每次调用独立历史 | 不是语义压缩，也不是精确 tokenizer 计量 |
| 会话恢复 | 当前主题、教学检查点和中断标记 | 工具对话/多步骤自然计划尚无持久逐步续跑与幂等账本 |
| Provider | DeepSeek 真实工具续写，Codex 文本 CLI，mock 离线 | Anthropic adapter、多 Provider 工具协议统一尚未实现 |
| 编码和终端 | 原有受控实验组件保留 | 没有给学习模型开放任意 Shell、补丁编辑或自动测试工作区 |
| 扩展与协作 | 原有课程 Skill 保留 | MCP、通用子 agent、多任务并发仍不属于本轮已交付能力 |
| 成本与重试 | 有轮次、事件和输出预算，工具错误反馈 | 没有精确费用统计、网络退避重试和任务级自动重试 |

后续建议按“持久工具会话与幂等恢复 → 语义上下文压缩/成本计量 → 其他 Provider → 独立受限编码工作区”推进；任意 Shell 与跨主题扩展需要先定义新的产品权限契约。

## 验证证据

- 原始基线：40 个测试文件、133 个测试通过。
- 失败测试先行：分别实际复现 11 个运行时问题、6 个 SSE/取消问题、5 个工具/预算缺口、2 个检查点问题和 2 个符号链接问题。
- 第一轮完整门禁已通过：46 个测试文件、166 个测试；integration 9 个、Eval 6 个、隔离 mock smoke 通过。
- Self-review 又补充“超轮次时不构造新 Provider 请求”用例；最终 `npm run verify` 退出码 0：46 个测试文件、167 个测试通过（比基线增加 34 个）；lint、typecheck、integration 9 个、Eval 6 个、隔离 mock smoke、敏感信息与 diff 检查全部通过。

- `npm run test:harness` 退出码 0：16 个文件、79 个测试通过；验证修正后的脚本实际覆盖工具协议、运行时和 CLI。

```bash
npm run verify
npm run test:harness
git diff --check
```

真实 DeepSeek、Codex 连通性与模型教学质量未在线验证：所有新增端到端调用使用假 Keychain、假 fetch 和临时 SQLite，不读取实际凭证、不外发用户资料。没有提交或推送 Git；保留用户原有未跟踪文档。路径校验覆盖预先存在的链接，无法消除恶意并发路径替换；调用预算不是费用承诺。
