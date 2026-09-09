# 安全说明

## 安全边界

- CLI 初始角色路由为本地 `mock`；桌面初始选择 Pi Codex，也可手动选择离线 `demo`。已配置的真实 Provider 默认允许调用，启动应用进程时设置 `ZHIXING_ALLOW_LIVE_PROVIDER=0` 可禁止真实请求；该开关不会自动将已选择的真实模型切为 mock/demo。向真实 Provider 发送的上下文范围见 [配置](docs/CONFIGURATION.md)。
- `topicId`、导入目录与受控写入路径隔离；资料内容不作为指令执行。
- 删除资料、恢复数据库、写入长期记忆均要求确认。
- 审计脱敏，禁止将 API Key、token、Cookie、用户资料提交到仓库。

## 桌面与凭据

- Electron renderer 启用 sandbox、context isolation 和 CSP，经本地 `zhixing://app` 协议加载；禁用任意导航、新窗口、远程图片及权限申请。preload 只暴露受控命令和事件，主进程检查来源、Zod 参数、UUID 与长度。
- 两个入口经同一 AgentService / LearningApplication 接入学习工作区，只有本会话授权后才提供当前主题上下文与读取工具，写入另需本次或会话授权；不给模型开放任意 Shell 或文件工具。内附 Pi SDK 不提供原生工具执行器；认证由 Pi 自己处理。
- DeepSeek / Kimi 的 CLI 配置分别存入 macOS Keychain。桌面新增配置通过主进程的异步 `safeStorage` 独立加密写入 `deepseek.credential` / `kimi.credential`；没有对应桌面配置时可复用同一 Provider 的 macOS Keychain 项。状态查询不返回 Key，读取现有 Key 只供受控 API 调用使用。密码输入内容在提交时经过 renderer，但没有将已保存 Key 回读给页面的接口。
- 聊天记录是应用目录内的明文 JSON，草稿保存在 renderer 的本地存储；API Key 加密不等于全部会话加密。Markdown 导出和复制会把所选内容写入用户指定文件或系统剪贴板。
- 桌面会话原子保存，拒绝预先存在的会话目录/文件符号链接；CLI 路径策略检查信任根之下的路径组件。这些检查不等同于防御任意本机进程的 OS 隔离。

## 依赖安全检查

根目录与 `desktop/` 分别维护依赖和锁文件。`verify` 与 `desktop-release` 工作流均在安装后检查两套生产依赖，遇到 high/critical 漏洞时失败；本地 `npm run verify` 不包含需要联网的 npm audit，须单独运行：

```bash
npm audit --omit=dev --audit-level=high
npm audit --prefix desktop --omit=dev --audit-level=high
```

两端 PDF.js 固定为 `6.2.108`，修复 [GHSA-hq66-cqwq-w95j](https://github.com/advisories/GHSA-hq66-cqwq-w95j)。内附 Pi 升级至 `0.85.0`，两端会话均使用公共 ModelRuntime 接口；旧安全启动器兼容用途仅使用 package.json 声明的 bin.pi。旧安装包不会随源码更新而改变，重新发布时需使用修复后的锁文件构建并验收。审计结果是执行时的快照，见 [依赖修复 Evidence](docs/evidence/dependency-security.md)。

## 已知边界

CLI 的引用校验验证文档与页码/锚点匹配，不保证逐句事实均有充分依据；桌面引用元数据经主题/文档/页码/锚点/片段 ID 校验，但不保证每句回答均得到引用支持。loopback 同步服务只提供本机 progress JSON/SSE，不是云同步。历史 Provider smoke 只证明当次请求结果，不证明当前登录持续有效。

桌面 macOS arm64 包目前为本地预览，没有 Developer ID 签名、公证。版本检查只在用户点击后查询 GitHub 公开元数据，不自动下载/执行更新。已有 macOS/Windows 构建与 draft release 工作流；两个 Mac 架构实包及 Windows 原生隔离、NSIS 实际安装和安装后 UI 均通过；系统加密为真实 safeStorage 合成往返检查，实际用户新密钥保存另行验收。详见 [当前证据](docs/evidence/completion-0.9.md)。

## 报告问题

请通过仓库维护者指定的安全渠道报告问题，并提供最小复现、影响范围和脱敏日志；不要提交真实资料、凭证或可访问链接。

实现边界与限制见 [安全约束](docs/pi-constraints.md) 和 [架构](docs/architecture.md)。

本地产物验证只在 macOS 受限沙箱中运行明确提交的 JavaScript 与测试脚本，禁止网络、限制文件内容访问与时间/输出；其他平台拒绝执行。用户测试报告标为未复跑，Review 分数只代表证据完整性。详见 [升级契约](docs/agent-upgrade.md)。

## 0.4 的应用工具与恢复边界

两个入口共用的 Pi SDK worker 没有原生工具执行器；Pi、DeepSeek 和 Kimi 产生的请求只由应用 ToolHarness 校验执行。学习资料、当前项目与外部 MCP 分别授权，写入权限绑定目标和操作；撤回会清除未执行的旧批准，未知副作用仍保留，写操作预览持久化后等待用户选择，模型不能授予自己权限。任务结果缓存会验证保存产物是否完整；实验仍使用 OS 隔离。

全量备份由用户操作触发，仅包含应用拥有的学习数据、会话与偏好，不包含凭据；文件夹备份没有加密。恢复先验证清单/哈希/数据库版本，创建新工作区与新会话，保留原数据，关闭继承的授权及自动队列。路径检查不构成对恶意本地进程并发换路径的 OS 沙箱。可选语义索引只访问 loopback Ollama，不会自动下载模型或连接外部向量服务。详细限制见 [0.4 指南](docs/agent-0.4.md)。

0.6 使用会话 v5 / SQLite 标记 5，旧二进制拒绝新格式；升级前可导出完整备份。项目修改前快照和日志恢复不会替代 OS 隔离；Python 仅在已验证的 macOS 环境运行标准库测试，禁止网络和工作目录外正文读取。完整产品效果试验不向模型自动暴露检查作答，构建来源不包含凭据/用户数据。详见 [0.6 指南](docs/agent-0.6.md)。

0.7 将学习画像、显式记忆、教学检查点和资料统一纳入会话授权。选择 Provider 不是授权；CLI 的材料标志不自动授权项目或 MCP。严格请求 schema 拒绝前端 prompt/history/runtime 覆盖；同主题教学租约防止跨入口并发覆盖，备份恢复清除临时租约。会话当前版本为 7，数据库版本为 6，旧版本拒绝覆盖新语义。见 [统一记忆设计](docs/agent-memory.md)。

## 0.8 本地访问收紧

MCP 的 `trusted` 模式保留账户权限信任边界；`restricted` 模式在 macOS 通过系统沙箱仅开放指定可执行程序、显式读取路径及临时工作目录写入，并禁止网络。目录读取授权包含子目录，应避免授权整个主目录。其他平台不能静默回退；工具 read 声明不替代 OS 隔离。

loopback 同步要求每个进程随机生成的临时访问码并限制 Host/Origin/GET、主题和 SSE 数量，拒绝无授权读取。它不防御已获得账户权限并能窃取本机进程信息的攻击者，也不提供远程身份管理。通知不包含聊天或作答内容；访问码和密钥不进入备份。

v7 原文片段逐一校验来源和内容哈希，缺失/损坏拒绝恢复；首次保存旧格式留备份。摘要哈希只证明引用原文一致，不能证明模型内容正确。教学检查点按会话保存，不让同主题其他对话覆盖当前练习。

0.9 图像采用受限内联 PNG/JPEG，不自动加载远程图片；视觉请求先检查模型能力。macOS 预览包的完整 ad-hoc 签名只满足本机应用身份/通知要求，不等同于 Developer ID 信任或公证。Windows AppContainer 隔离与实际平台验收范围见[当前证据](docs/evidence/completion-0.9.md)。

自定义 API 连接只接受严格的公开配置和 Bearer Key 认证。身份哈希绑定地址、模型、协议和能力；同 ID 不能重指向新端点。桌面为每个连接单独保存系统密文，根地址禁止 URL 认证/查询参数、远端 HTTP 和自动重定向。未找到原连接时明确失败；备份排除密文，恢复只合并公开定义。移除配置不删除对话或密文。更多边界见[配置](docs/CONFIGURATION.md#自定义-api-连接092)。
