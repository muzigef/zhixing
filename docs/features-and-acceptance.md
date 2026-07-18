# 功能设计与验收

> 状态：本文保留部分历史验收设计。当前可执行命令、Provider 与 P3 个性化学习能力以 [CLI 参考](CLI-REFERENCE.md)、[配置](CONFIGURATION.md)、`TASKS.md` 和 P3 Evidence 为准；未实现的历史设想不构成当前功能。

## 当前 P3 增量

- 每主题可保存学习画像（目标、水平、每日分钟、周期），生成待确认的个性化计划。
- 可从画像生成受限本地 Skill 草案；只有显式启用后才进入当前主题 Skill Catalog。
- `资料概览` 仅汇总本主题资料与画像状态；`学习建议` 默认本地生成。
- `学习建议 --允许外发` 使用当前 tutor 路由，发送范围仅限画像与资料名称；不会自动完成 Day。

## 1. 用户命令与行为

| 命令/自然语言 | 功能 | 成功输出 | 关键约束 |
| --- | --- | --- | --- |
| `主题列表` / `学习 <主题>` | 列出主题或选择主题并创建/恢复其学习空间 | 主题摘要、当前主题或确认请求 | 切换主题不读取其他主题 session |
| `开始第 N 天` | 在当前主题内读取计划，创建或恢复 Day 记录，输出讲解和实验卡 | 目标、4 小时安排、证据、开始任务 | 必须先通过该主题的前置 Day gate |
| `继续` | 从进行中的 Day 找到最小未完成步骤 | 单一下一步 | 不重复整段课程 |
| `检查 <证据>` | 解析测试/代码/反思证据并执行 reviewer | 0–8 评分、verdict、最小修复 | 缺证据不可标完成 |
| `进度` | 汇总当前主题 `PROGRESS.md` 与记录 | 完成数、当前、阻塞、评分、下一步 | 只报告当前主题的已记录事实 |
| `全部进度` | 汇总各主题的只读摘要 | 每主题完成数和下一步 | 不合并或泄露主题 session/错题详情 |
| `复习` / `考我` | 从近五个完成日和错题生成至多 5 张卡片 | 卡片 + 首题 | 不将未验证内容写成掌握 |
| `读源码` | 在实验合格后给出限定源码导读问题 | 对照问题、目标路径、记录模板 | 未通过实验时拒绝并给补救任务 |
| `调整计划` | 基于可用时间重排未完成日 | 变更建议和确认差异 | 不覆盖原计划，另存调整记录 |
| `导入资料 <文件>` | 导入当前主题的 PDF 或 Markdown | 文档摘要、页数/段落数、索引状态 | 文件类型、大小、主题归属和重复哈希均需校验 |
| `资料库` | 列出当前主题已导入资料 | 标题、导入时间、解析/索引状态 | 不显示其他主题资料 |
| `查询资料 <问题>` | 在当前主题资料中检索并回答 | 结论、引用、证据不足提示 | 无引用不得生成知识结论 |
| `记住 <内容>` / `忘记 <记忆>` | 管理可删除的长期记忆 | 记忆 ID、来源、主题和状态 | 只允许写入经确认的结构化记忆 |
| `取消` | 终止当前模型/工具运行 | `cancelled` 事件 | 不损坏 session 或笔记 |
| `模型列表` / `模型状态` | 查看内置 Provider、角色路由和健康状态 | 不含凭证的状态摘要 | 不显示 API Key、token 或 Cookie |
| `模型添加 api-key deepseek-api` | 添加 DeepSeek API Key | Keychain 中的 `secretRef` | 隐藏输入，配置文件不写明文 |
| `模型切换 <role> <provider>` | 修改角色模型路由 | 生效路由 | Provider 必须已注册；真实调用仍要求环境开关 |

## 2. 首批工具

| 工具 | 权限 | 输入/输出 | 失败处理 |
| --- | --- | --- | --- |
| `resolve_topic` | 只读 | 用户请求 -> `topicId` 或候选主题 | 歧义时要求用户确认，不猜测 |
| `read_plan` | 只读 | `topicId`、Day -> 计划片段 | Day 不存在返回结构化 `not_found` |
| `list_skills` / `read_skill` | 只读 | `topicId` -> 摘要/正文 | 只暴露 shared 与当前主题 skill；坏 frontmatter 不污染旧 catalog |
| `read_progress` | 只读 | `topicId` -> 进度表及 Day 状态 | 缺文件时生成“未初始化”结果 |
| `write_day_record` | 受限写 | `topicId`、day、section、Markdown -> 写入位置 | 原子写失败，保留旧版本 |
| `update_progress` | 受限写 | `topicId`、合法状态转移 -> 新行 | 非法转移或跨主题写入返回 `denied` |
| `review_evidence` | 只读计算 | 目标、证据 -> `ReviewVerdict` | 证据不足为 `repair`，非异常成功 |
| `read_source_excerpt` | 只读 | 仓内相对路径、范围 -> 文本 | allowlist 外路径拒绝 |
| `configure_provider` | 受限写 | Provider 配置 -> 无敏感配置与 `secretRef` | Key 仅经 SecretStore 写入安全存储 |
| `provider_health_check` | 受控执行 | Provider ID -> 连通性、能力和错误分类 | 官方 CLI 仅允许白名单 argv；不得读取凭证文件 |
| `update_model_routing` | 受限写 | role、provider:model -> 路由配置 | 未健康或未授权 Provider 拒绝 |
| `import_document` | 受限写 | `topicId`、文件 -> document 元数据与索引状态 | 只接收允许格式；哈希去重；扫描 PDF 返回 `ocr_required` |
| `search_library` | 只读 | `topicId`、query -> Chunk、页码/段落、分数 | 强制主题过滤；结果为空不是模型错误 |
| `write_memory` | 受限写 | `topicId`、内容、来源、置信度 -> memory ID | 需用户确认或 reviewer/资料来源；禁止自由写入 |
| `search_memory` | 只读 | `topicId`、query -> 可追溯记忆 | 默认不跨主题；返回来源和时间 |

第一版不注册 `bash`、通用 `write_file` 或网络搜索。这是学习助手而非代码执行代理；将来需要执行用户实验时，也应先增加受限测试命令白名单和显式确认。

## 3. 既有能力迁移

保留当前 `skills/agent-learning*` 的知识内容与行为约束，迁入 `zhixing/skills/shared/` 或通过只读注册目录引用。主题专属能力置于 `zhixing/skills/<topicId>/`。迁移顺序如下：

1. `agent-learning` 成为唯一的路由 skill，声明命令到工作流的映射。
2. tutor、lab、notebook、reviewer、source-guide、roadmap 保持独立 shared skill，且附加 `tags: [learning]` 与风险字段；主题专属 skill 必须声明所属 `topicId`。
3. Runtime 只把 shared 与当前主题 skill 的名称和 description 放进上下文；模型须先执行 `read_skill` 获取正文。
4. DayGate 在 tool 层强制执行“当前主题的前置 Day / 实验证据 / 源码导读”规则，不能仅依赖 skill prompt。

## 4. 模型配置与安全存储

```text
zhixing/settings/
  model-routing.local.json # 本地角色路由；不含密钥
```

DeepSeek API Key 通过隐藏输入写入 macOS Keychain，配置只保存形如 `keychain:zhixing/deepseek-api` 的引用。Codex 仅复用用户机器中已登录的官方 CLI；知行不得读取浏览器 Cookie、CLI token 或认证文件，也不得在日志中记录认证输出。当前未实现 Claude、本地模型或其他 API adapter。

`ModelRouter` 支持按 `tutor`、`reviewer`、`lab` 角色配置主模型和 fallback。API adapter 可记录经 Provider 返回或估算的 usage；订阅 CLI adapter 只能记录调用次数、耗时和结果状态。

## 5. 资料库、RAG 与长期记忆

资料导入首版支持文字 PDF 和 Markdown。普通 PDF 使用 `pdfjs-dist` 提取页码文本；扫描件不进行静默 OCR，而是标记 `ocr_required`。原文件按主题保存，SQLite 保存文档、页、Chunk、哈希、解析状态和引用定位；FTS5 提供主题内关键词检索。文件上限、分块策略、事务回滚、SQLite schema、记忆生命周期、删除备份和隐私模式遵循 [数据、记忆与质量契约](data-and-quality-spec.md)。PDF/Markdown 内容均为不可信资料，不能改变系统规则或触发工具调用。

RAG 回答必须给出引用：PDF 使用文件名和页码，Markdown 使用文件名和段落锚点。没有命中或引用不充分时返回“资料中证据不足”。当前检索以 FTS5 与本地 `HashEmbeddingModel` 融合，向量写入 `chunk_embeddings` SQLite 兼容表；不使用 `sqlite-vec`。资料量或并发增长后再评估 LanceDB。

长期记忆分为工作、主题学习、知识、长期画像和情节记忆。只有用户明确要求、reviewer 已通过，或具有资料引用与置信度的内容可进入 `MemoryStore`；每项可查询、追溯和删除。

## 6. 可观测性

每次 run 在 `zhixing/data/audit/<topicId>/` 写入脱敏 JSONL：`run_started`、`tool_started`、`tool_finished`、可选 `model_invoked`、`run_finished`（失败或取消时为对应状态）；每条事件都带 `topicId`。模型审计仅包含实际 Provider、角色、耗时与状态，不含 prompt、回答或凭证。

## 7. 验收集

以下用例在 mock 模型下自动执行，是真实模型 smoke 前的发布门槛：

| ID | 场景 | 预期断言 |
| --- | --- | --- |
| E01 | 新用户启动 Day 1 | Day 文件为“进行中”，输出四个固定栏目 |
| E02 | 直接启动 Day 4 | 拒绝推进，指出 Day 1 为最早前置 |
| E03 | 提交缺少失败案例的证据 | verdict=`repair`，Day 不完成 |
| E04 | 提交满足目标、测试和反思的证据 | verdict=`advance`，Day 与进度原子更新为完成 |
| E05 | 请求读 Day 10 源码但 Day 10 实验未过 | 被拒绝并返回最小补练 |
| E06 | 多轮 `继续` | 仅输出最小下一步，避免重复课程 |
| E07 | `取消` 进行中的流 | 收到 cancelled，session 可继续发新输入 |
| E08 | 试图以 `../` 或符号链接写文件 | 权限拒绝，允许根外文件未变化 |
| E09 | skill frontmatter 无效 | 返回 schema 错误，旧 catalog 仍可读 |
| E10 | 日志包含模拟 token | 落盘审计不含 token 原文 |
| E11 | 模型适配器故障 | 输出可理解降级提示，进度读取仍可用 |
| E12 | 最大轮次/重复调用 | Runtime 停止且记录明确原因 |
| E13 | 在 `rag` 与 `tool-calling` 各启动 Day 1 | 生成两个独立进度和记录目录，内容不交叉 |
| E14 | 切换至 `rag` 后执行 `继续` | 只读取 `rag` session 与近期记录，不注入 `tool-calling` 内容 |
| E15 | 尝试通过 `rag` 的写工具修改 `tool-calling` 记录 | 权限拒绝，目标主题文件未变化 |
| E16 | 执行 `全部进度` | 只返回各主题汇总，不返回其他主题 session 或错题详情 |
| E17 | 添加 API Key 并检查配置/审计 | Key 仅进入 mock SecretStore；配置、session、审计均不包含明文 |
| E18 | 使用 Codex CLI 路由 | 仅调用官方 CLI；不读取 Cookie、token 或认证文件 |
| E19 | 官方 CLI 不存在、登录失败或不支持 | 返回结构化错误，Router 降级到 mock/备用 API Provider |
| E20 | 切换 tutor 模型 | 仅更新该角色路由，其他角色与主题状态不受影响 |
| E21 | 导入文字 PDF | 原文件、页面文本、Chunk 和 FTS5 索引落入当前主题；可返回页码引用 |
| E22 | 导入扫描 PDF | 返回 `ocr_required`，不生成虚假可检索文本 |
| E23 | 查询已导入资料 | 结果只来自当前主题，回答包含文件名和页码/段落引用 |
| E24 | 资料无相关证据 | 返回 `insufficient_evidence`，不得编造答案或引用 |
| E25 | 写入和删除长期记忆 | 无确认/来源的写入被拒绝；已确认记忆可按 ID 删除 |
| E26 | 跨主题查询资料或记忆 | 默认拒绝/为空；明确全局查询才返回带主题来源的结果 |
| E27 | 超限、损坏或加密资料导入 | 返回稳定错误码，不产生可检索的残留 Chunk |
| E28 | 导入中取消或解析失败 | SQLite 事务回滚，原文件和失败状态可追溯 |
| E29 | 分块与引用定位 | 每个 Chunk 有主题、哈希、页码/anchor；引用可定位回原文 |
| E30 | 删除资料或主题记忆 | 先展示影响范围；关联 FTS/citation 被清理，其他主题不受影响 |
| E31 | 纯本地模式与外部发送确认 | 纯本地模式不发生外部请求；非本地模式首次发送资料前要求确认 |

## 8. 发布门槛

```bash
npm run lint
npm run typecheck
npm run test
npm run test:integration
npm run eval
npm run smoke:mock
# 真实 Provider smoke 是受控手工步骤，不是 package script
```

通过标准：lint/typecheck 全绿；E01–E31 全部通过；mock smoke 产生一条完整、脱敏且带 `topicId` 的 run；资料 smoke 必须验证引用、证据不足、导入回滚和主题隔离路径；真实 smoke 失败不阻断发布，但必须记录 provider、错误分类和降级行为。AI 不能只根据模型回答宣称验收完成，必须保留命令输出与评估报告。
