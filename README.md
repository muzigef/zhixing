# 知行（ZhiXing） Agent

面向本目录 Agent 学习计划的本地优先学习代理。它把现有的学习路线、导师、实验、复盘、笔记和源码导读能力收敛为一个可恢复、可验证的 CLI Agent。

> 面试 Demo：无需 API Key 即可使用 mock 和本地学习流程。已配置的真实 Provider 默认可用；设置 `ZHIXING_ALLOW_LIVE_PROVIDER=0` 可强制不发起外部模型调用。当前版本为 `0.1.0`，未授权不得再分发。

## 快速开始

前置条件：Node.js `24.8.x`、npm。若要处理扫描 PDF，另需本机 `tesseract` 与 `pdftoppm`。

```bash
npm ci
npm run verify
npm run start -- '主题列表'
npm run repl
```

首次体验可输入：`学习 rag`、`开始第 1 天`、`进度`。`学习 <主题>` 会保存当前主题，之后重启 REPL 会自动恢复；将资料放入 `inbox/<topicId>/` 后，使用 `导入资料 <topicId>/<文件名>` 导入。

配置真实 tutor 后，也可以直接说“创建 3DGS 的学习计划”。知行会只追问缺少的信息，给出草案；回复一次“直接运行”便保存画像、生成并启用定制课程。随后“开始第 1 天”会进入模型讲解与追问，而不是要求复制 CLI 命令。

计划启用后会先展示目标、周期、每天预算和阶段路线。真实 tutor 的单日学习按“深度讲解 → 答疑确认 → 练习测验 → 实验与证据 Review”推进：讲解结束可以直接提问；确认没有疑问后输入“没有问题，开始练习”才会出题。

输入 `诊断` 可查看当前 Provider、教学检查点、记忆、资料和恢复状态。教学阶段保存在主题 session 中，重启 REPL 后会恢复受限检查点。模型按命令最小化装配上下文：资料问答发送检索证据，学习建议发送画像与资料名称，教学发送当天学习卡及受限主题上下文，自然交互发送当前会话文本。

完整操作见 [快速开始](docs/GETTING-STARTED.md)、[CLI 参考](docs/CLI-REFERENCE.md)、[配置](docs/CONFIGURATION.md) 与 [故障排查](docs/TROUBLESHOOTING.md)。

## MVP 边界

- 当前 CLI：`学习 <主题>`、`开始第 N 天`、`继续`、`进度`、`全部进度`、`读源码 DNN`、`导入资料 <inbox 相对路径>`、`资料库`/`资料概览`、`查询资料 <topicId> <问题>`、`资料问答 <问题> --允许外发`、`检查 DNN --实现 --测试 --失败 --复盘`、`记住 <内容> --确认`、`查询记忆 [topicId] <问题>`、`忘记 <memoryId>`、资料删除预览/确认删除、数据库备份/恢复、模型管理、`启动同步服务 [port]`、Skill、计划与复习命令。

### 个性化学习（不依赖模型）

学习画像、计划草案、资料概览和 Skill 草案均为本地通用能力，不依赖 Codex、DeepSeek 或任何 API。示例：

```sh
npm run start -- '设置学习画像 掌握 RAG 面试 --水平 初学 --每天 45 --周期 14' --topic rag
npm run start -- '生成个性化计划' --topic rag
npm run start -- '生成技能草案 rag-interview' --topic rag
```

计划和 Skill 先生成草案，分别以 `启用个性化计划 <version>`、`启用技能草案 <name>` 纳入当前主题；这不会自动改变 Day 的完成状态。模型仅是可选的问答/建议提供方。

`学习建议` 使用当前 `tutor` 路由（mock、Codex CLI 或 DeepSeek API 均可），并且只发送画像与已导入资料的文件名，不发送资料原文。`--允许外发` 仍可兼容使用，但当前版本是否允许真实调用由 `ZHIXING_ALLOW_LIVE_PROVIDER` 控制。
- 本地扩展：扫描 PDF 会尝试 Tesseract OCR，低于 70 分会保留 `ocr_low_confidence` 状态；检索以 FTS5 与本地确定性向量融合并重排序。
- 输出：流式学习引导、明确的实验卡、结构化复盘，以及 Markdown 学习记录。
- 数据：主题记录、错题、进度、资料与 session 相互隔离；学习资料支持 PDF/Markdown 导入，首版通过 SQLite FTS5 做带引用检索。
- 记忆：工作记忆、主题学习记忆、可追溯知识记忆、长期画像和情节记忆分层保存；默认只检索当前主题。
- 模型：当前通过多 Provider `ModelClient` 适配器接入 DeepSeek API Key 与本机官方 Codex CLI 登录态；默认 mock，确保无 API Key 也能完成自动化测试。
- 不做：浏览器自动化、任意 Shell 执行、自动完成用户练习、无限制多 Agent、云端同步，以及读取浏览器 Cookie 或保存订阅账号 token。

## 文档导航

| 主题 | 文档 |
| --- | --- |
| 安装、配置与使用 | [快速开始](docs/GETTING-STARTED.md)、[配置](docs/CONFIGURATION.md)、[CLI 参考](docs/CLI-REFERENCE.md) |
| 开发与质量 | [开发指南](docs/DEVELOPMENT.md)、[测试指南](docs/TESTING.md)、[故障排查](docs/TROUBLESHOOTING.md) |
| 设计与安全 | [架构设计](docs/architecture.md)、[数据与质量契约](docs/data-and-quality-spec.md)、[安全说明](SECURITY.md) |
| 交付状态 | [开发计划](docs/development-plan.md)、[任务台账](TASKS.md)、[变更记录](CHANGELOG.md) |
| 协作与授权 | [贡献指南](CONTRIBUTING.md)、[许可](LICENSE) |

## 当前运行数据目录

```text
zhixing/
  src/                 # TypeScript ESM 实现
  skills/              # shared/ 与主题专属 Markdown 工作流
  tests/               # 单元、集成与评估测试
  settings/            # 无密钥模型路由与本机覆盖配置
  data/                # 按主题保存的 session、run、审计、原始资料（gitignore）
  db/                  # SQLite 元数据、FTS5 索引和长期记忆（gitignore）
  docs/                # 本设计与实施证据
learning-notes/
  topics/<topicId>/    # 主题独立的学习记录与受控笔记
```

## 完成定义

三天交付的 MVP 必须在 mock 模型下通过单元、集成和评估集；真实模型仅作为可选 smoke。每一轮 run 都必须保留无敏感信息的事件记录，并且不能将某个学习日标为完成，除非证据和复盘均通过。资料问答必须返回文件与页码/段落引用；没有足够证据时必须明确拒答。

## 当前验证状态

P0–P5 已在 mock 与本地路径下完成自动化覆盖。运行 `npm run verify` 可复现 lint、typecheck、测试、integration、eval 与 mock smoke 的完整质量门禁。

P1 已完成逐 Day Topic Plan、主题课程模板、按需 Skill 摘要、citation 强制的 grounded answer、评分驱动复习与 topic-scoped session snapshot。验收记录见 `docs/evidence/p1-acceptance.md`。

P2 已完成本地 OCR adapter、低置信度标记、SQLite 向量兼容存储与混合检索、无 Docker 的 macOS `sandbox-exec` 受限执行包装，以及仅绑定 `127.0.0.1` 的进度/SSE 同步服务。详细证据与尚未执行的环境级验收见 `docs/evidence/p2-acceptance.md`。

P3 已完成模型无关的画像、计划、资料概览与 Skill 草案闭环；`学习建议` 本身使用当前 tutor 路由，且只发送画像和资料文件名。见 `docs/evidence/p3-personal-learning.md`。

已知限制：OCR 需要本机安装 `tesseract` 与 `pdftoppm`；受限执行仅在具备 macOS `sandbox-exec` 时可用，缺失时安全返回 `unavailable`；同步服务只监听 loopback，不提供公网或云端同步。Docker/Colima 不再是运行依赖。

真实 Provider smoke 仍是可选项：已配置的真实 Provider 默认可用，可设置 `ZHIXING_ALLOW_LIVE_PROVIDER=0` 强制本地模式。资料问答会将检索证据发送给当前 tutor；数据库恢复和资料删除命令始终需要命令级确认。

## 面试评审建议

优先查看 `npm run verify`、`tests/cli-workflow.test.ts`、`docs/evidence/` 和 `docs/architecture.md`。可从本地 RAG、主题隔离、引用约束、审计脱敏、Provider 外发边界与 P2 本地能力六个维度评审。
