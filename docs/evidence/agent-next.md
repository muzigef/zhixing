# P12 持续验收记录

## 2026-09-05：质量基线与角色上下文

- 两套依赖通过公共 npm registry 安装，未更改全局配置。质量评测新增失败测试后通过，`npm run verify` 通过（312 个测试）。日志 `/tmp/zhixing-next-quality-verify.log`。
- 已运行 `npm run eval:quality -- --live --output=docs/evidence/agent-quality-baseline.json`，全部输入来自临时合成工作区，原始答案及耗时保存在 [基线结果](agent-quality-baseline.json)。Pi 首次调用未返回有效答案，其余 23 项标注未尝试。DeepSeek 24 次中 22 次完整返回，R02 两次均中途失败；完成率不是质量得分。
- 阅读第一轮 DeepSeek 原答发现：R01 未遵循两段限制；R08 重复已讲内容；R11 得出正确数值但错误地描述为“巧合/接近”；一般问题被无关检索材料干扰。原答保留用于下一次相同任务对照，尚不能宣称产品已对齐商业 Agent。
- 结构化上下文增加 2 项边界测试；system 不包含用户目标/摘要/材料，DeepSeek 收到真实角色序列。Pi 旧 CLI 先隔离 system，桌面 SDK 接入进一步原生化历史角色。
- 结构化切片 `npm run verify` 通过（314 个测试），两套桌面 UI smoke 通过。日志 `/tmp/zhixing-next-context-verify.log`、`/tmp/zhixing-next-context-ui.log`。

## 双 Provider 执行与恢复

- Pi 0.85.0 公共 SDK 缺失声明的 pi-server 运行依赖，补充固定版本 `@earendil-works/pi-server@0.85.0` 后公共 import 和 worker `--check` 均通过；安装时审计 0 漏洞。
- 独立 worker 仅调用 Pi ModelRuntime.streamSimple，没有 AgentSession、原生 shell 或文件工具。工具定义作为协议数据交给模型，执行由应用 ToolHarness 管理。思考/协议状态仅在本次工具循环内存中使用，不进入可见回答或审计。
- 应用新增任务计划/状态、保存产物和隔离实验工具；计划完成依赖真实保存或测试成功。数据库保存操作结果，幂等产物 ID 可恢复写入中途遗留的文件。权限来自桌面本轮/会话控制，不来自模型参数。
- 定向测试、全量 verify、桌面 UI 均通过。日志 `/tmp/zhixing-next-tools-verify.log`、`/tmp/zhixing-next-tools-ui.log`。

## 2026-09-06：速度、交互、检索

- 深度与篇幅独立：快速/均衡/深入映射 Provider 支持的选项；DeepSeek 工具续写保留本次调用内的 reasoning_content，不在 UI/日志展示。参数依据 [DeepSeek 官方思考模式文档](https://api-docs.deepseek.com/guides/thinking_mode/)。
- 传输上限与正文上限分开，解决含大量 SSE 元数据时正常长回答被过早截断的问题。`agent-quality-long-answer.json` 的 R02 两次完整返回，12.088 秒和 8.448 秒。只说明本次复测，不能推断所有请求稳定性。
- 历史整理改为答完后的可取消维护，新输入取消旧整理；首字不再等待摘要。按模型/思考档位提供首字和报告的 Token 统计，不估算未知费用。
- 问题、授权、产物、进度与最终答案类型化。审批卡展示确切内容，批准后只执行保存的操作；回复能恢复同一任务。编辑创建新分支，清除旧写授权；父分支回答可并排比较。
- 新增 `smoke-interactions.mjs` 验证批准一次仅保存一份产物、回答问题、编辑分支、权限重置与父分支对比。交互阶段 verify 与三套 UI 全通过：`/tmp/zhixing-next-interaction-verify.log`、`/tmp/zhixing-next-interaction-ui.log`。
- 中文分词/同义词与确定性重排取代哈希碰撞作为召回依据，补充相邻块；答案标记匹配的引用和候选资料分开展示，仍不把位置匹配当作逐句事实证明。
- 可选本机 Ollama 语义索引，仅 loopback、禁止重定向、不自动下载模型；按模型 digest 与片段 hash 隔离缓存。接口依据 [Ollama embed 文档](https://docs.ollama.com/api/embed)。使用测试向量验证跨语言检索路径、主题隔离、模型版本/文档变化失效；真实嵌入效果需本机服务。
- 检索阶段 `npm run verify` 和三套 UI 通过：`/tmp/zhixing-next-retrieval-verify.log`、`/tmp/zhixing-next-retrieval-ui.log`。

## 独立检查、扩展与恢复

- 内置 24 道独立检查题，作答/错因/复盘/复习日期与 EvidenceStore 分开，不能自动授予掌握或完成。定向测试与 assessment 阶段完整 verify/三套 UI 通过。
- 桌面技能元数据与正文预览、按需工具读取已接入；文件大小/路径/符号链接约束，坏文件保留最后有效缓存。构建内附技能，不覆盖工作区自定义文件。
- 全量备份包含工作区资料/笔记/技能/设置/审计/SQLite 一致快照及桌面会话和偏好，逐文件校验后恢复为新工作区和新会话。测试验证凭据排除、篡改拒绝、链接拒绝、原数据保留。恢复不替换当前偏好或继承授权。
- 会话 v1 读取不改写，保存前生成原文备份并写 v2；未来会话/数据库版本拒绝。数据库版本标记更新为 4，CLI 原有备份契约同步。
- 修复幂等缓存跨步骤改名重复保存、缓存结果对应产物遭修改仍报成功、语义模型运行时换版本混入旧索引等边界。新增定向失败测试后通过全量验证。
- 三套 UI 覆盖具体审批/问题卡/产物、编辑分支/对比、技能与备份恢复；实际查看聊天与课程窗口截图，公式、输入框与滚动内容无明显重叠。

## 最终本机验证（2026-09-06）

| 命令或检查 | 真实结果 |
| --- | --- |
| `npm run verify` | 75 个测试文件、336 个 Vitest 测试通过；integration、eval、mock smoke、lint/双类型检查、敏感内容与空白检查全部通过 |
| `npm --prefix desktop run test:ui` | 聊天、学习、交互三套开发 UI 通过；覆盖实际隔离 JavaScript 测试 |
| 两套 `npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org` | 根目录和 desktop 均 0 漏洞 |
| `CSC_IDENTITY_AUTO_DISCOVERY=false npm --prefix desktop run dist:mac` | 0.4.0 macOS arm64 App、DMG、ZIP 构建完成 |
| 设置 `ZHIXING_DESKTOP_EXECUTABLE` 指向最终包后执行 `test:ui` | 同三套实际应用 UI 全部通过，含备份恢复和重启 |
| 包内 Electron Node / Pi SDK worker `--check`（联网关闭） | `sdkReady:true`，无系统 Node/Pi 依赖的 SDK 导入通过 |
| `hdiutil verify desktop/release/Zhixing-0.4.0-mac-arm64.dmg` | VALID |
| `npm --prefix desktop run checksums` | 生成两个安装器 SHA-256 |

本轮日志：`/tmp/zhixing-next-final-verify.log`、`/tmp/zhixing-next-final-ui.log`、`/tmp/zhixing-next-packaged-ui.log`、`/tmp/zhixing-next-package-final.log`、`/tmp/zhixing-next-packaged-sdk.log`、`/tmp/zhixing-next-dmg-verify.log`。临时日志不会随 Git 分发，本记录、测试和脱敏真实质量原答可在仓库追溯。

最终安装包均来自本轮代码，版本 0.4.0，最低 macOS 13.0：

- DMG：292022968 字节；SHA-256 `575931fa25197c098173991ae4880b01c195c5b421bf5e54a902d760550ae6e6`。
- ZIP：300077547 字节；SHA-256 `42292bd244339f4f401e15ff29e746697829bc1c2570c23e96c51c7c5d5da23a`。
- 本轮固定补入 pi-server 运行依赖，安装体积较 0.3 增加；没有 Apple Developer ID 签名、公证。产物位于忽略的 `desktop/release/`，不会提交 Git。

## 真实质量与外部验收

[质量复核](agent-quality-review.md)保留逐题问题，复核者是开发助手而非独立人工评委。DeepSeek 完整复测 24 次：22 次完成文本、2 次实际澄清等待、0 次连接失败。Pi 首次仍失败，其余 23 次未尝试；错误不足以断言仅是登录问题。普通纠错和前置阻碍已改善，续写重复、多余追问、资料归因和部分解释精度仍有未通过样本，不宣称达到商业 Agent 的输出水平。均衡档与中断边界修复的单项复测另存，不能替代原完整集评分。

本机 Ollama 未运行（loopback 连接失败），语义路径有模拟向量/模型版本测试，真实嵌入效果未验收。Windows、Intel Mac 实机及远端 Actions 尚未执行；发布矩阵和可选签名配置已完成，Developer ID/Apple 公证需要真实账户。MCP 未连接具体服务，通用编码/worktree/多 Agent 仍为条件性范围。
