# 通用模型接入架构验收

> 历史验收快照：下文的测试数量、失败、安装及“待验”状态仅适用于记录当次执行；未重新运行或改写历史结果。当前实现与后续进展见 [当前状态](../current-status.md) 和 [证据索引](README.md)。

日期：2026-09-11。用户将其他厂商调整为后续扩展，本轮以通用接口及已配置三家为准。详见[架构契约](../provider-architecture.md)。

## 改动

原生厂商执行逻辑从公共进程宿主拆出，形成 NativeRuntimeAdapter、集中适配器注册及两端共用目录。Codex 既有官方参数、认证和解码保留；Claude 既有实现独立保存；Gemini 未启用。通用宿主统一检查输出边界与流式/最终结果一致性。API 协议保持原实现，增加目录外厂商通过真实工厂及共享 AgentService 的合成验收。没有增加新厂商调用、修改账号、改变默认模型或扩大预算。

## 过程与验证

测试先复现缺少公共适配器契约与目录。44 项定向测试通过，包含 6 项原生扩展测试、三协议的目录外厂商连续会话，以及原有认证、取消、工具拒绝和截断回归。一次新测试误用了 AgentReply.status，已改为检查真实持久消息状态，未改变产品行为以迎合测试。两端依赖安装、完整门禁、实际包 UI 和三家适度复验结果继续记录于下方。

此前 [20 次真实预算对照](team-resource-budget-20260911.md)属于前一候选包。本轮不改模型提示、预算和任务协议，使用定向真实连通回归；不把历史分数称为本包质量重跑。


两套 `npm ci` 均退出 0，未变更依赖版本。`CI=1 npm run verify` 退出 0：153 个文件 / 814 项测试，lint、两端类型检查、integration、eval、mock smoke、敏感信息及 diff 检查通过；日志 `desktop/.local/provider-architecture-verify.log`。7 份相关文档本地链接检查通过。

实际 Codex 0.153.4 离线协议探针退出 0：请求包含教学指令、工具列表为空、合成服务不带认证头。实际官方二进制四项隔离探针全部通过：允许范围内读取、拒绝越界读取、拒绝符号链接绕过、拒绝写入。日志 `provider-architecture-native-offline.log` 与 `provider-architecture-isolation.log`（位于 `desktop/.local/`）。这两项不读取真实账号文件，也不作为真实模型回答成绩。

`npm --prefix desktop run pack` 退出 0，沿用已固定本地签名，未创建证书或更改权限。新候选包 app.asar SHA-256：`7f9354f0e452c1b1c525d2f493890ad133f561ec4f0776bee6df7ebe41a2eceb`。新包未替换已安装应用。


指定上述实际候选包运行 `npm --prefix desktop run test:ui`，退出 0：桌面、学习、交互、教学结果、项目、API、团队七组全部通过；日志 `desktop/.local/provider-architecture-ui.log`。其中 API 组覆盖原生 Codex/Claude 程序配置、切换和合成对话，以及动态厂商和三协议；团队组覆盖任务持久化、部分失败及定向恢复。UI 运行使用隔离夹具，不能替代真实账号验收。

重构后的源码执行器通过官方 Codex 订阅最小真实题：8,337 ms，首次完整消息 5,814 ms，输入 9,499 / 输出 5 token，答案正确。使用直连，未改系统代理或重新登录；日志 `desktop/.local/provider-architecture-codex-live.log`。该项是官方执行器真实回归；实包上的官方运行时调用另由上述隔离 UI 验证，不能将二者合称为同一次实包真实 Codex 请求。


使用同一实际签名候选包的 `check-installed-api.mjs --live`，分别经应用现有安全存储及 IPC 检查 DeepSeek / Kimi，两次均退出 0：DeepSeek 857 ms（首字 772 ms），Kimi 16539 ms（首字 16535 ms）。没有导出密钥或更改保存配置。固定合成连通题不代表工具、图片或回答质量全验收。日志 `provider-architecture-deepseek-live.log`、`provider-architecture-kimi-live.log`。三项真实结果摘要见[记录](provider-architecture-live-20260911.json)。

结论：本轮通用架构、扩展契约及现有三家兼容回归完成。其他厂商、Gemini 执行器、Claude 真实账号、SDK / App Server 均保持按需扩展范围，不阻塞当前交付，也没有被标记为已实现或已真实验证。源码和候选包保留本地，未提交、推送或替换安装应用。
