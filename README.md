# 知行（ZhiXing）

知行是一个本地优先的学习 Agent。它通过 CLI 和 REPL 管理学习主题、资料、计划、教学会话、证据 Review 与 Provider 路由；学习状态可恢复，资料问答带可定位引用，模型驱动的动作必须经过统一的授权、确认与证据校验。

## 核心能力

- 主题化学习：选择或创建主题，保存当前主题，重启后恢复学习上下文。
- 课程与进度：按 Day 推进，前置条件与 Review 证据决定是否可以进入下一阶段。
- 个性化计划：学习画像、个性化计划、定制课程与 Skill 草案均可本地生成和启用。
- 教学闭环：真实 tutor 支持讲解、答疑、练习、索要参考答案与作答批改；只有能追溯到用户原文的作答才能触发批改和学习记录。
- 本地资料库：导入 Markdown/PDF，扫描 PDF 可选本地 OCR；SQLite FTS5 与本地向量混合检索，资料问答要求可定位引用。
- 多 Provider：`mock`、`deepseek-api`、`codex-cli` 可按 tutor/reviewer/lab 角色路由；真实 Provider 支持文本流。
- 受控 Agent runtime：统一输入分类、模型计划确认、运行账本、脱敏审计、工具 schema/风险/超时/输出限制，以及受限工具循环协议。

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
学习 rag
开始第 1 天
开始任务
进度
```

执行 `学习 <主题>` 后，当前主题保存在本机设置中；下次进入 REPL 会自动恢复。

## 常用流程

### 创建或定制学习计划

真实 tutor 已配置时，可以直接用自然语言描述学习目标，例如：

```text
创建 3DGS 的学习计划
```

知行会追问缺失信息并生成可执行草案。回复 `直接运行` 可保存学习画像、生成并启用定制课程；高风险操作则要求 `直接运行 --确认`。

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

### 学习中的自然交互

真实 tutor 的单日流程是：讲解 → 答疑 → 练习 → 实验与证据 Review。

- 讲解后可以直接提问；确认没有疑问时输入 `没有问题，开始练习`。
- 练习中可说 `给出答案`、`给出参考解析` 或提出澄清问题。
- 只有实际输入且可验证的作答会进入批改；模型不能把自己的内容当成用户答案。
- 完成后使用 `检查 DNN --实现 --测试 --失败 --复盘` 提交证据。

## Provider 配置

默认路由使用本地 `mock`。DeepSeek API Key 通过隐藏输入写入 macOS Keychain；Codex 复用已登录的官方 Codex CLI，不读取或保存登录凭据。

```text
模型添加 api-key deepseek-api
模型切换 tutor deepseek-api --确认
模型切换 tutor codex-cli --确认
模型状态
```

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
