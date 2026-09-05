# 安全说明

## 安全边界

- CLI 初始角色路由为本地 `mock`；桌面初始选择 Pi Codex，也可手动选择离线 `demo`。已配置的真实 Provider 默认允许调用，启动应用进程时设置 `ZHIXING_ALLOW_LIVE_PROVIDER=0` 可禁止真实请求；该开关不会自动将已选择的真实模型切为 mock/demo。向真实 Provider 发送的上下文范围见 [配置](docs/CONFIGURATION.md)。
- `topicId`、导入目录与受控写入路径隔离；资料内容不作为指令执行。
- 删除资料、恢复数据库、写入长期记忆均要求确认。
- 审计脱敏，禁止将 API Key、token、Cookie、用户资料提交到仓库。

## 桌面与凭据

- Electron renderer 启用 sandbox、context isolation 和 CSP，经本地 `zhixing://app` 协议加载；禁用任意导航、新窗口、远程图片及权限申请。preload 只暴露受控命令和事件，主进程检查来源、Zod 参数、UUID 与长度。
- 桌面经 LearningApplication 接入学习工作区，只有本会话授权后才提供当前主题上下文和只读学习工具；不给模型开放任意 Shell 或文件工具。内附 Pi 显式使用空工具列表和已审查守卫；认证由 Pi 自己处理。
- DeepSeek 的 CLI 配置存入 macOS Keychain。桌面新增配置通过主进程的异步 `safeStorage` 加密写入 `deepseek.credential`；没有桌面配置时可复用旧 macOS Keychain。状态查询不返回 Key，读取现有 Key 只供受控 API 调用使用。密码输入内容在提交时经过 renderer，但没有将已保存 Key 回读给页面的接口。
- 聊天记录是应用目录内的明文 JSON，草稿保存在 renderer 的本地存储；API Key 加密不等于全部会话加密。Markdown 导出和复制会把所选内容写入用户指定文件或系统剪贴板。
- 桌面会话原子保存，拒绝预先存在的会话目录/文件符号链接；CLI 路径策略检查信任根之下的路径组件。这些检查不等同于防御任意本机进程的 OS 隔离。

## 已知边界

CLI 的引用校验验证文档与页码/锚点匹配，不保证逐句事实均有充分依据；桌面引用元数据经主题/文档/页码/锚点/片段 ID 校验，但不保证每句回答均得到引用支持。loopback 同步服务只提供本机 progress JSON/SSE，不是云同步。历史 Provider smoke 只证明当次请求结果，不证明当前登录持续有效。

桌面 macOS arm64 包目前为本地预览，没有 Developer ID 签名、公证。版本检查只在用户点击后查询 GitHub 公开元数据，不自动下载/执行更新。已有 macOS/Windows 构建与 draft release 工作流；Windows 系统密钥存储和运行行为尚未实机验收。详见 [桌面证据](docs/evidence/desktop-app.md)。

## 报告问题

请通过仓库维护者指定的安全渠道报告问题，并提供最小复现、影响范围和脱敏日志；不要提交真实资料、凭证或可访问链接。

实现边界与限制见 [安全约束](docs/pi-constraints.md) 和 [架构](docs/architecture.md)。

本地产物验证只在 macOS 受限沙箱中运行明确提交的 JavaScript 与测试脚本，禁止网络、限制文件内容访问与时间/输出；其他平台拒绝执行。用户测试报告标为未复跑，Review 分数只代表证据完整性。详见 [升级契约](docs/agent-upgrade.md)。
