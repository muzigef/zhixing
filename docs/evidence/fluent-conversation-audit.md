# 连续对话与终端交互修复

> 历史证据：下文的测试数量、命令输出、提交状态、机器配置和“当前”均指本阶段记录时。2026-09-05 文档核对保留这些历史结果；现行功能与配置见 [功能验收](../features-and-acceptance.md)、[配置](../CONFIGURATION.md)，后续阶段见 [证据索引](README.md)。

日期：2026-09-05。范围：P8，承接 P6/P7。实现、测试和文档均未提交或推送 Git。

## 目标与依据

让普通问答能够接着聊、及时显示、随时停止或调整，并减少必须记忆的固定命令。

参考已核对的官方交互契约：[Codex CLI](https://learn.chatgpt.com/docs/codex/cli)、[Codex app-server](https://learn.chatgpt.com/docs/app-server)、[Claude Code 交互模式](https://code.claude.com/docs/en/interactive-mode) 和 [Claude Code 会话](https://code.claude.com/docs/en/sessions)。从这些文档中选取持续输入、运行中调整、取消、状态反馈和会话恢复作为本项目的具体验收点；没有声称复制完整产品或采用它们的内部实现。

## 已修复与覆盖

| 问题 | 当前行为 | 验证 |
| --- | --- | --- |
| 生成时输入无法即时控制 | 读输入与执行分离；普通请求串行排队，状态和停止即时响应 | 控制器与实际 CLI 停滞 SSE 测试 |
| 修改要求仍需等原答案完成 | “等等，换个例子”或 `/steer` 停止文本生成，使用原问题和部分回答继续 | 实际 CLI 验证新请求带原问题和未完成内容 |
| 短段落没有换行便不显示 | 约 80 毫秒刷新普通段落，分隔符保留到可判定时，长行继续分段 | 停滞且无换行的 SSE 已显示；格式单测 |
| 打字与模型输出挤在同一行 | 未完成回答先换行；正在编辑草稿时暂存新增显示，提交或取消后释放 | ReplOutput 测试与真实 PTY 分次输入 |
| 普通聊天重启丢失 | 每主题会话自动保存并恢复，含正常停止的部分回答 | Store、实际 CLI 跨进程测试 |
| 无法另起话题后找回旧对话 | `/new` 新建，`/resume` 列出最近会话并按编号恢复 | 切换、重启、跨主题拒绝测试 |
| “继续”被误解为学习进度命令 | 有对话上下文时继续回答；重试重新提出上一请求 | 实际 CLI 跨进程继续与控制器覆盖 |
| 多行代码变成多次请求 | `/paste` 到 `/send` 只发送一次，也支持反斜杠换行 | 多行原文与单次模型请求测试 |
| 自由问答不能主动查询已有信息 | 支持工具的 tutor 可直接查当前主题进度与目录；本次明确同意后才开放正文检索 | 实际 DeepSeek 协议合成工具往返与同意边界测试 |
| 确认草案必须记口令 | 存在草案时“就按这个来”“好，执行吧”可执行；高影响动作保留原确认策略 | 协议与实际 CLI 草案测试 |
| 隐藏输入可能重放进聊天 | 单一输入桥，隐藏输入期间独占，读取结束后不重放缓存 | 合成敏感输入无回显、无重放测试 |
| 新聊天后重返教学的模式未持久化 | “开始任务”恢复检查点并保存教学模式 | 先红后绿的跨进程回归 |
| 合法长中文/转义文本存得下却读不回 | 文件字节限制按既有字符契约的最坏 JSON 编码计算 | 6 轮最大长度 Unicode/转义文本读写回归 |
| `/exit` 后标准输入仍保持活动 | 关闭输入桥时暂停来源并还原终端模式 | 真实 PTY `/exit` 后进程退出码 0 |

## 实现边界

- 新模块：`src/conversation-session.ts`、`src/repl-controller.ts`、`src/repl-input.ts`。
- 接入与内容：`src/cli.ts`、`src/learning-agent.ts`、`src/teaching-prompts.ts`、`src/teaching-dialogue.ts`、`src/interaction-protocol.ts`、`src/terminal-markdown.ts`。
- 普通聊天最近 6 轮，每轮用户输入与回答各最多 8,000 字符；旧文本截断有标记。输入最多排队 16 条，恢复列表最多显示最近 20 个会话。
- 调整只会抢占文本生成；写操作仍串行执行。排队中的请求可用 `/queue clear` 撤回。
- 教学检查点和普通会话分别保存；恢复聊天不会回滚学习进度。主题范围仍由 PathPolicy 与 Store 校验。
- 普通问答自动工具调用仅适用于支持知行工具协议的 Provider。现有 DeepSeek 适配器支持，Codex 文本适配器不因此获得工具调用能力。
- 未新增依赖或外部服务，未改动用户资料和真实凭证。

## 验证结果

基线为 P7 的 49 个测试文件、221 个测试。新增失败测试先复现会话缺失、无法即时控制、多行拆分、自然工具路由和边界问题，再实现并运行回归。

最终执行 `npm run verify`，退出码 **0**：

- lint、typecheck 通过。
- **52 个测试文件、249 个测试通过，较 P7 增加 28 个测试。**
- integration 9 个测试、Eval 6 个测试通过。
- 临时根目录 mock smoke、敏感信息扫描、`git diff --check` 通过。

重点测试为 `tests/conversation-session.test.ts`（5）、`tests/repl-controller.test.ts`（7）、`tests/repl-input.test.ts`（4）、`tests/interaction-cli.test.ts`（18）、`tests/learning-agent-cli.test.ts`（4）、`tests/terminal-markdown.test.ts`（7）。实际 CLI 测试启动独立进程，并使用临时 SQLite、假的 Keychain 和本地 fetch/SSE 夹具。

另在真实 PTY 中使用临时根与模拟 Provider 手动验证：短文本未换行即出现 → 分两次输入调整要求，输入独占新行 → 提交后停止并继续回答 → Markdown 标题/列表/代码/公式文本可见 → `/exit` 退出码 0。没有读取真实 Keychain，也没有发出真实模型请求。

可复现的自动化命令：

```bash
npm run test -- tests/conversation-session.test.ts tests/repl-controller.test.ts tests/repl-input.test.ts tests/interaction-cli.test.ts tests/learning-agent-cli.test.ts tests/terminal-markdown.test.ts
npm run verify
```

## 已知限制与后续评测

- 合成响应证明控制流、上下文、格式显示与边界正确，不能证明真实模型的知识准确率、教学质量或响应速度。真实模型效果评测尚未执行。
- 输入界面仍为行式终端，尚无固定底部编辑区、Slash 自动补全、会话选择器或完整 Markdown/LaTeX 排版。输入草稿时显示会暂缓，模型本身仍运行。
- 多行输入需要 `/paste` 或反斜杠；未宣称自动识别所有终端的多行粘贴快捷键。
- 会话在请求前和结束时保存。正常取消保存部分回答；强制结束进程可能丢失尚未保存的增量。同一主题同时启动多个进程仍没有会话写锁。
- 最近历史采用数量与字符截断，未实现模型摘要压缩或全量历史搜索；计划草案仍在当前进程内，恢复时不会重放动作。
- 自然语言路由仍有启发式边界；复杂复合要求可能需要澄清。引用合法性不等于每句话已得到事实核验。

本切片已通过本地验收。下一步应以固定题集评估真实 Provider 的事实正确性、解释清晰度、上下文延续和指令遵从，再决定是否增加完整终端编辑界面；本次未把这些未验证项计入完成范围。
