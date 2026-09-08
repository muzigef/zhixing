# 桌面与 CLI 策略统一执行记录

基线 `32decd4`，2026-09-08。范围与一致性定义见[执行计划](../unified-agent-plan.md)。

## 已确认的差异

- `CliAgentTransport` 除 `/agent` 和其续接外使用 profile 自定义调用；`cli.ts` 普通问答、教学先构建 prompt 再通过 `invoke` 执行。
- `AgentService` 自定义调用不走正常应用上下文/工具装配，完成后也不运行后台摘要。
- 完整消息已经在共享 Store 中，旧六轮历史是兼容投影，但 CLI 仍将它用于模型输入。
- 桌面 `LearningApplication.context` 与 CLI `LearningContextBuilder` 选择的学习状态不同；CLI Pi 仍使用仅文本通道，桌面使用 SDK 工具通道。

以上属于本轮必须消除的差异，不是已完成的策略一致性。

## 实现结果

上述差异已在 0.7.0 消除：前端不再传入 AgentInvocation/profile/runtime；普通问答、教学和计划预览统一经过 AgentService、历史构建、学习快照、ToolHarness 和上下文预算。Pi 两端使用同一源码 worker 与 Pi 0.85.0 公共 ModelRuntime。详细契约见 [统一记忆设计](../agent-memory.md)。

| 切片 | 实现与证据 |
| --- | --- |
| U01 | LearningApplication 每轮读取画像、带来源 ID 的确认记忆和教学检查点；新增删除、撤权及主题隔离测试先失败后通过。第一次完整 verify 为 111 文件、554 测试，退出 0。教学动作与状态提交随后收敛到共享业务层。 |
| U02 | 删除 CLI 最终 prompt、教学分类与专用历史缓冲，删除共享服务自定义调用分支。真实 CLI 的完整历史回归先失败后通过；停止/续接/排队/审计保留。6 文件 53 项定向测试通过。 |
| U03 | CLI 与桌面共用模型工厂、Pi worker、工具续轮、预算和禁联网开关。实际 CLI 经合成公共 SDK 验证错误、取消和历史；4 文件 17 项通过。U01–U03 合并后的完整 verify 为 112 文件、558 项，退出 0。 |
| U04 | 严格请求 schema、前端依赖门禁；真正启动 CLI 与桌面 DeepSeek 请求体对照；普通/教学会话的摘要、回读、用量等价；撤权、教学跨会话租约与备份清理；最终完整质量门及开发/实包 UI 如下。 |

教学共享检查点新增每主题跨进程租约，不同入口的两个会话不能同时推进同一检查点；停止后释放。备份恢复清除临时租约。会话写入 v6，首次保存 v1–v5 时备份原文件；SQLite 标记 6，保留原表与资料，旧二进制拒绝打开新语义。

## 最终验收（2026-09-08，macOS arm64 / Node 24.8.0）

| 命令/检查 | 结果 |
| --- | --- |
| 根与 desktop 两套依赖安装 | 退出 0；新增根 Pi 0.85.0 依赖通过公共 registry 安装。 |
| `npm run verify` | 退出 0；lint、两套类型检查、114 文件 / 567 测试、integration 9、eval 6、mock smoke、敏感内容扫描及 diff 空白检查通过。 |
| `npm --prefix desktop run test:ui` | 退出 0；聊天、学习、交互、效果流程、项目五组全部通过。包含 1,001 条 IPC 增量后的精确最终文本及复制结果。 |
| `npm --prefix desktop run dist:mac` | 退出 0；生成 0.7.0 macOS arm64 DMG 和 ZIP。 |
| 指定 `ZHIXING_DESKTOP_EXECUTABLE` 为 release 中实际 `.app/Contents/MacOS/知行` 后重跑 `test:ui` | 退出 0；同样五组全部通过，使用隔离合成工作区。 |
| 两套 `npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org` | 均退出 0，均为 0 个生产漏洞。镜像审计接口曾返回 400，随后明确使用公共 registry，不把接口错误当作通过。 |
| `hdiutil verify` | 退出 0，DMG 校验有效。 |
| 只读挂载 DMG 比较 | 版本 0.7.0；主可执行文件、app.asar、Pi worker、构建来源文件的 SHA-256 与已验收 `.app` 相同；完成后卸载。 |

构建 codeHash：`ec289e9aacd254316322629ee1176a96dbbb3d6df797446d89dc07b090c3c511`。源码构建和实包来源记录一致；对应基线 `32decd4` 加本轮尚未提交的源代码，未伪称已发布 GitHub Release。

安装包（`desktop/release/`，Git 忽略）：

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `Zhixing-0.7.0-mac-arm64.dmg` | 293014960 | `ca88d46ee0a02d867767a557e3bc752638ee5ecd26316c2d25bc98ba99da8393` |
| `Zhixing-0.7.0-mac-arm64.zip` | 301213345 | `be61b541cf77368f8b533c76621b217254dd83223651b513cde1f77dc7075832` |

## 本轮失败与修复记录

- 原 CLI 只选五轮模型历史，导致仍在完整记录中的原文遗漏：改为共享历史构建和回读工具。
- 原桌面没有画像/显式记忆/旧教学检查点召回：加入共享快照，读取后检查取消，撤权不读取。
- 新调用链暴露旧测试的非 UUID 资料 ID：夹具改为符合产品契约的 UUID，保留检索原文与审计断言。
- 终端观察回调异常曾影响任务完成：输出/统计观察现在隔离失败，共享任务仍正确保存。
- 严格 schema 拒绝桌面 IPC 的 `type/steer` 元数据：主进程适配器在进入 AgentService 前拆开信封，保持请求旁路拒绝规则；重跑五组 UI 通过。
- 数据库版本检查旧断言仍为 5：更新为版本 6，同时保留旧会话只读、首次保存备份及未来版本拒绝断言。
- 同主题教学并发和恢复后的旧租约分别由先失败的测试复现，现已防止覆盖并在恢复时清理。
- 根 Pi 新依赖使原开发依赖中的旧 brace-expansion 成为生产依赖：升级兼容补丁，生产审计归零。

## 验证边界

本轮模型测试使用合成 SDK / HTTP 响应，证明实际入口和请求协议一致；没有重新验证真实 Pi 登录、DeepSeek 余额/网络或真实学习效果。0.6 的历史真实请求证据仍是历史结果，不用于代替本轮一致性测试。安装包仍未做 Developer ID 签名、公证，未实测 Windows 或 Intel Mac。本轮生成并验收安装包，不代表用户 Applications 中既有安装已自动替换。

相同策略要求相同业务模式与规范化配置；两个入口仍可有独立的工作区、会话、偏好和界面。模型随机输出不作为逐字相等承诺。CLI 草案展示/确认和本地管理命令属于界面与业务操作，模型上下文、长期记忆、摘要及工具执行策略由共享内核决定。
