# 知行（ZhiXing）

知行是一个本地优先的学习 Agent。它通过 CLI 和 REPL 管理学习主题、资料、计划、教学会话、证据 Review 与 Provider 路由；学习状态可恢复，资料问答带可定位引用，模型驱动的动作必须经过统一的授权、确认与证据校验。

## 核心能力

- 主题化学习：选择或创建主题，保存当前主题，重启后恢复学习上下文。
- 课程与进度：按 Day 推进，前置条件与 Review 证据决定是否可以进入下一阶段。
- 个性化计划：学习画像、个性化计划、定制课程与 Skill 草案均可本地生成和启用。
- 自然问答与教学：无需先建计划即可提问；支持追问、举例、教学代码、练习、参考答案和有原文依据的作答批改。
- 连续对话：普通问答按主题自动保存，重启接着聊；支持新对话、恢复旧对话、继续和重试。
- 回答体验：生成时可继续输入、即时查看状态、停止或调整要求；支持多行粘贴、按主题保存回答风格，以及保留代码和公式的 Markdown 显示。
- 本地资料库：导入 Markdown/PDF，扫描 PDF 可选本地 OCR；SQLite FTS5 与本地向量混合检索，资料问答要求可定位引用。
- 多 Provider：`mock`、`deepseek-api`、`codex-cli`、`pi-codex` 可按 tutor/reviewer/lab 角色路由；真实 Provider 支持文本流。
- 受控 Agent runtime：统一输入分类、模型计划确认、运行账本、脱敏审计；DeepSeek 支持真实多轮工具调用，工具 schema/主题/风险/取消/超时以及总轮次、事件和上下文均受运行时限制。

## 快速开始

前置条件：Node.js `24.8.x` 与 npm。处理扫描 PDF 时还需要 `tesseract` 和 `pdftoppm`。

```bash
npm ci
npm run verify
npm run start -- '主题列表'
npm run repl
```

在 REPL 中可以使用：

```text
/help
学习 rag
/style balanced
解释 RAG 和微调的区别，用表格比较
开始第 1 天
来一道题
/status
```

执行 `学习 <主题>` 后，下次进入 REPL 会恢复该主题及其当前对话。普通聊天保留最近 6 轮，每轮用户输入和回答各保留最多 8,000 字符。

## 常用流程

### 创建或定制学习计划

真实 tutor 已配置时，可以直接用自然语言描述学习目标，例如：

```text
创建 3DGS 的学习计划
```

知行会追问缺失信息并生成可执行草案。看到草案后说 `就按这个来`、`好，执行吧` 或 `直接运行`，即可执行受支持的动作；高风险操作仍要求 `直接运行 --确认`。

也可以完全不使用模型：

```bash
npm run start -- '设置学习画像 掌握 RAG 原理与实践 --水平 初学 --每天 45 --周期 14' --topic rag
npm run start -- '生成个性化计划' --topic rag
npm run start -- '启用个性化计划 personal-plan-<version> --确认' --topic rag
npm run start -- '生成技能草案 rag-retrieval' --topic rag
npm run start -- '启用技能草案 rag-retrieval --确认' --topic rag
```

### 导入与查询资料

先将资料放入 `inbox/<topicId>/`，再导入：

```bash
npm run start -- '导入资料 rag/notes.md'
npm run start -- '查询资料 rag 如何提供可定位引用'
npm run start -- '资料问答 检索如何提供引用 --允许外发' --topic rag
```

资料默认在本机处理。资料问答若没有足够证据或缺少引用，会返回 `insufficient_evidence`。

### 使用受控学习助手

已配置 DeepSeek 后，可以让模型主动查询进度或资料，并根据工具结果继续回答：

```text
模型切换 tutor deepseek-api --确认
根据我的进度建议下一步
结合已导入资料解释 RAG 的引用机制 --允许外发
```

普通自由问答可直接使用工具，无需 `学习助手` 前缀；显式前缀仍兼容。助手默认只能读取当前主题的进度和资料目录；本次命令末尾带 `--允许外发` 才开放资料正文检索。工具错误会反馈给模型以调整查询；总计最多 6 轮、32 次工具请求和 180 秒。教学阶段保留原有教学流程；mock、codex-cli 和 pi-codex 文本适配器不支持知行工具调用。

### 学习中的自然交互

真实 tutor 的单日流程是：讲解 → 答疑 → 练习 → 实验与证据 Review。

- 可以先直接提问，不必建立画像或课程；教学中也可随时说 `举个例子`、`简短一点`、`用代码说明`。
- 要练习时说 `开始练习`、`来一道题` 或 `出两道题`；默认一题，明确数量和题型时按要求生成。旧口令 `没有问题，开始练习` 仍兼容。
- 练习中可说 `给答案`、`给出参考解析`、`换一道题`；索要提示或答案不会记作用户作答。
- 只有实际输入且可验证的作答会进入批改；模型不能把自己的内容当成用户答案。
- 完成后使用 `检查 DNN --实现 --测试 --失败 --复盘` 提交证据。

`/style concise`、`/style balanced`、`/style detailed` 分别设置当前主题的简洁、适中、详细风格，重启后保留；也支持 `回答风格 简洁` 等中文形式。本轮的“只要结论”“详细推导”“用表格”等要求优先于默认风格。

`/status` 查看主题、教学阶段和风格；`/cancel-plan` 或 `取消草案` 取消待执行草案，继续问答；`/plan <需求>` 明确进入计划管理。计划草案和教学可以并存，知识问题不会因出现“模型”“课程”等词而退出教学。

### 连续聊天与中途调整

生成期间可以继续输入，普通消息按顺序处理。输入 `等等，用生活例子解释` 或 `/steer 新要求` 会停止当前文本生成，结合原问题和已生成内容继续回答；`停止` 或 Ctrl-C 只停止当前回答。`/status` 随时查看处理状态与排队数量，`/queue clear` 撤回尚未处理的消息。

- `继续`、`接着说`：有对话上下文时接着回答；`重试` 或 `/retry` 重问上一条请求。
- `/new`：开启新对话，原对话保留；`/resume` 列出当前主题最近 20 个对话，再用 `/resume <编号>` 恢复。
- `/paste`：进入多行输入，粘贴代码或长问题后单独输入 `/send` 发送；`/cancel-input` 撤销。也可以用行末反斜杠换行。

会话恢复不会回滚学习进度或教学检查点。正常停止会保存已生成的部分回答；进程被强制结束时，可能只保留请求和最后一次已保存的内容。

终端支持标题、列表和强调，代码围栏、表格和 LaTeX 公式保留文本。`NO_COLOR=1` 或输出重定向时保留可复制的 Markdown，不加入终端颜色。当前终端不进行公式排版，回答要求在公式后附中文解释。短段落约每 80 毫秒刷新，无需等待换行；输入草稿时暂存新增显示，提交或取消后再显示，避免和输入挤在一行。`/exit` 退出。

## Provider 配置

默认路由使用本地 `mock`。DeepSeek API Key 通过隐藏输入写入 macOS Keychain；Codex 复用已登录的官方 Codex CLI，不读取或保存登录凭据。

```text
模型添加 api-key deepseek-api
模型切换 tutor deepseek-api --确认
模型切换 tutor codex-cli --确认
模型状态
```

### 使用 Pi 已配置的 Codex 模型

如果已经在 Pi 中配置并登录 Codex，可直接使用：

```text
模型切换 tutor pi-codex --确认
```

知行每轮读取 Pi 全局设置与项目 `.pi/settings.json` 中的默认模型和推理强度，要求默认 Provider 为 `openai-codex`。项目同名设置优先，模型 ID 不写死。Pi 自己使用已有登录状态；无需在知行填写 API Key。

此适配器通过 `scripts/pi-safe.sh` 启动 Pi，使用 JSON 文本流与临时会话，保留项目守卫，清空工具白名单。普通问答、教学、计划生成和资料问答仍由知行现有流程处理；它不把 Pi 的文件或命令工具开放给模型。普通对话遇到 Pi 错误会明确提示，不会静默改用其他模型。

设置 `ZHIXING_ALLOW_LIVE_PROVIDER=0` 可禁用真实 Provider。真实调用只发送当前任务所需的最小上下文；凭证、审计原文和其他主题资料不会外发。

## 安全与运行模型

- 每轮输入都先经过统一控制层；模型输出只能提出建议，不能自行执行写操作或把推断写成用户事实。
- 删除资料、恢复数据库、切换模型、启用计划/Skill 等高影响操作需要显式确认。
- 每个前台操作有 SQLite 运行/步骤账本与脱敏审计。中断运行会安全标记为 `process_interrupted`，不会自动重放可能写入的操作。
- 工具调用统一经过 schema 校验、主题边界、风险授权、强制超时和输出上限。
- Provider trace 记录 Provider、角色、耗时、状态、事件数、回合数和工具调用数；不记录 prompt、回答或工具参数。

输入 `诊断` 可查看当前主题、Provider、教学检查点、资料、记忆、提醒与最近运行摘要。

## 数据目录

```text
zhixing/
  data/       # 主题 session、审计与资料数据（忽略提交）
  db/         # SQLite 元数据、检索索引与记忆（忽略提交）
  inbox/      # 待导入资料（忽略提交）
  settings/   # 本机主题与模型路由设置（忽略提交）
learning-notes/
  topics/     # 主题学习记录（忽略提交）
```

## 验证

```bash
npm run verify
```

该质量门运行 lint、类型检查、单元测试、CLI 工作流、集成测试、评估与 mock smoke。

## 文档

| 主题 | 文档 |
| --- | --- |
| 安装与首次使用 | [快速开始](docs/GETTING-STARTED.md) |
| 命令说明 | [CLI 参考](docs/CLI-REFERENCE.md) |
| Provider 与数据边界 | [配置](docs/CONFIGURATION.md) |
| 架构与安全模型 | [架构设计](docs/architecture.md)、[数据与质量契约](docs/data-and-quality-spec.md)、[安全说明](SECURITY.md) |
| 开发与验证 | [开发指南](docs/DEVELOPMENT.md)、[测试指南](docs/TESTING.md)、[故障排查](docs/TROUBLESHOOTING.md) |

运行时审查、修复证据和仍未对齐的能力见 [Agent 审查报告](docs/evidence/agent-runtime-audit.md)。
