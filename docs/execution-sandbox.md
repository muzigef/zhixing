# 统一执行策略与平台沙箱

核对日期：2026-09-17。适用源码；安装包、远端原生测试结果另见[本轮验收](evidence/sandbox-20260917.md)。不把宿主权限检查、Worker、临时目录或 mock 当作 OS 隔离。

## 执行路径

```text
CLI / Electron / 主 Agent / 团队成员
  → 共享 AgentService / ToolHarness（任务范围、参数、授权、幂等与恢复）
  → 学习证据 / 实践项目 / restricted MCP
  → LocalSandbox（输入快照、路径/大小校验、不可变策略、能力检查）
  → SandboxBackend（macOS / Linux / Windows）
  → 受限进程 → 宿主管理的结果回执 → 持久化结果

固定宿主操作 → hostProcess(用途) → 固定适配器 / 最小环境 / 有界生命周期
```

[策略](../src/sandbox-policy.ts)、[入口](../src/local-sandbox.ts)、[契约](../src/sandbox-types.ts)、[平台选择](../src/sandbox-backends.ts)与[宿主进程网关](../src/process-gateway.ts)各自负责一种边界。模型不能选择系统平台、关闭沙箱、增加进程数或放开网络。工具层仍核对业务权限；本机沙箱不能撤销已经发生的远程副作用。

## 默认策略与差异

默认每次执行：5 秒墙钟、5 秒 CPU、512 MiB 内存、合计 64 KiB stdout/stderr、16 MiB 工作目录、256 个目录项、2 MB 输入、一个工作负载进程、禁止网络。输入路径规则在平台选择前执行，统一拒绝路径穿越、Windows 设备名、大小写冲突和文件/目录冲突。Node/Python 的运行时线程不等于允许启动子进程。

实践调用可以把墙钟设置为剩余预算，最多 10 秒；Node/Python 两阶段仍共用实践任务的截止时间。受限 MCP 的连接级预算为 300 秒墙钟、30 秒 CPU、2 MB 输出，工具请求另有原来的超时。预算达到上限会关闭连接；后续发现可建立新连接。初始化的受限进程发现等待包含系统首次启动开销，不再套用 trusted 进程的 600 ms 探测窗口。

Python 的解释器探测、私有运行库准备及代码执行使用同一截止时间，取消时等待清理完成；已完成的工作不会因为清理跨过期限而追溯变成超时。Windows 标准库以私有 ZIP 提供，`._pth` 只包含该归档和 `DLLs`，排除第三方包、缓存和 reparse 链接。目录配额按稳定句柄枚举，区分待删除对象与真正的访问拒绝。实现及故障复验见 [Windows CI 修复](evidence/windows-sandbox-ci-20260917.md)。

| 保证 | macOS | Linux | Windows |
| --- | --- | --- | --- |
| 文件/网络 | Seatbelt 默认拒绝；必要系统运行库和显式读授权；只写临时目录；拒绝网络 | bubblewrap 的只读系统运行库/显式读挂载、私有工作目录、独立网络/PID/IPC/用户命名空间 | 无额外 capabilities 的 AppContainer；只复制运行时和输入；不修改原安装目录 ACL |
| 子进程 | Seatbelt 不授予 fork | seccomp 拒绝 fork/vfork/非线程 clone；clone3 返回 ENOSYS；禁止干预监控进程 | Job Object 活动进程数 1 + 子进程创建限制 |
| CPU | RLIMIT_CPU | RLIMIT_CPU | Job Object 进程 CPU 时间 |
| 内存 | 每约 10 ms 监控子进程 RSS | 每约 10 ms 监控子进程 RSS | Job Object 限制提交内存，完成端口识别超限 |
| 磁盘 | 工作目录扫描；另有单文件 RLIMIT_FSIZE | 工作目录扫描；另有单文件 RLIMIT_FSIZE | 工作目录扫描 |
| 输出 | 宿主按字节计数，超限终止 | 同左 | helper 合并两路字节预算，超限终止 |
| 取消/父进程消失 | supervisor 检测、杀子进程；宿主有进程组兜底 | supervisor + 父进程死亡信号 + bubblewrap 生命周期 | Job Object + 控制管道 EOF/取消 |
| 交互式 restricted MCP | 支持 | 后端支持；需要系统允许非特权 user namespace | 当前不支持，明确拒绝，不能转为 trusted |

**监控不是硬上限。** macOS/Linux 的 RSS 与 Windows 的提交内存不是同一统计口径；轮询期间内存/磁盘可能短暂超额。`requireHardMemoryLimit: true` 在不具备硬内存限制的后端启动前失败。工作目录扫描也不是文件系统配额，不能宣称能严格限制宿主瞬时磁盘占用。本地实现面向受限练习与用户选定的工具，不作为多租户敌对代码服务的安全保证。

macOS 允许全局文件元数据读取，不代表允许文件内容读取。Linux 只读系统挂载含 `/usr`、`/lib` 等运行时路径，并非逐个库文件授权。显式 MCP 目录读授权包含其子目录，应选择专用目录；它不是自动脱敏机制。Windows 私有运行时复制不支持任意外部读目录，因此受限 MCP 的该能力不会被假装实现。

## 全部原生执行入口审计

| 入口 | 管理方式及信任边界 |
| --- | --- |
| `LearningApplication.validateEvidence` | 共享 LocalSandbox；桌面和 CLI 共用 |
| `PracticeProjects.test` 的 Node/Python | 同一 LocalSandbox；输入快照和内容哈希；测试不是 shell/npm 安装入口 |
| `McpConnection` restricted | 同一 LocalSandbox.open；仅 stdin/stdout RPC；OS 资源限制覆盖整个进程 |
| `McpConnection` trusted/旧配置 | 显式本地进程信任；hostProcess 管理；没有 OS 文件/网络隔离，工具的 read 标签不能替代隔离 |
| 原生订阅 Provider | hostProcess + NativeAgentExecutor；官方运行时管理认证；现有版本/能力检查、工具禁用和原生权限配置继续生效 |
| Pi 模型 worker | hostProcess + 固定共享 worker；SDK 产生模型事件；实际工具仍由 ToolHarness 执行 |
| 旧 `CodexCliClient` | 移除真实启动通路；默认请求报 `legacy_codex_runtime_retired`，注入 runner 只保留兼容测试 |
| Git 实践存储 | hostProcess，固定命令/参数、工作目录和禁用 hooks/fsmonitor 的现有策略 |
| 构建来源 Git | hostProcess；禁用 fsmonitor/hooks，隔离全局 Git 配置和环境 |
| Python 探测 | hostProcess；固定 `-I -S` 探测脚本、候选路径和极小环境；用户 Python 测试只在沙箱中执行 |
| Python 标准库归档 | 登记的 `python-runtime` hostProcess；固定 `-I -S -B` 程序仅归档所选解释器的标准库，排除第三方包/缓存/链接并限制大小、条目数、时间及输出；学习者代码不在宿主执行 |
| 钥匙串迁移/访问 | 固定 security 适配器经 hostProcess；凭据不进入模型、审计或沙箱环境；本次不触发真实凭据读取 |
| OCR | hostProcess，固定 pdftoppm/tesseract、超时/输出上限、最小环境；这是受信任的本机解析器，不提供其漏洞利用后的 OS 隔离保证 |
| JSON Schema Worker | 固定 Worker 源码，AJV 接收数据；线程堆/栈和 deadline 限制；不是任意用户脚本或 OS 沙箱 |
| Skill | 当前加载说明/引用内容，不增加通用脚本启动入口；若未来新增脚本能力，必须走 LocalSandbox |
| Electron renderer / URL 打开 | renderer 经 preload/IPC；URL 只走现有协议校验后的 openExternal，不是模型任意命令入口 |

[入口架构测试](../tests/execution-entrypoints.test.ts)扫描源代码 AST：原始 child_process 只允许出现在两个沙箱后端和宿主网关；每个 hostProcess 调用必须来自表中登记的模块并匹配用途；新增 Worker 入口必须显式审查。网关是受信任代码的工程约束，不是防止恶意开发者改源码的权限边界。

## 结果、构建与验收

结果区分 `completed`（仍需看退出码）、`timed_out`、`cancelled`、`unavailable`、`resource_limited`。超限另给出 memory/cpu/output/workspace 原因。代码打印的“成功”不能伪造回执：POSIX 使用子进程关闭的专用控制 FD，Windows 使用受信任 helper 组装结果。`policyId` 标识资源策略，不替代任务输入哈希或完整授权身份；MCP 配置另纳入工具身份。证据与实践记录保存策略/后端及超限原因。

开发与验收命令：

```bash
npm ci
npm ci --prefix desktop
npm run test:sandbox
CI=1 npm run verify
npm --prefix desktop run test:ui
```

`sandbox:build` 使用系统 C 编译器或 Windows .NET 编译器构建受信任 helper。桌面 build 同时复制当前平台 helper；运行时缺失不现场编译或降级。Linux 另需安装 bubblewrap，系统禁止 user namespace 时返回不可用，不自动修改系统权限。预检查仅表示文件存在，不能代替实际执行成功。

[真实探针](../tests/sandbox-boundaries.test.ts)先验证合成文件、监听端口和工作目录确实可用，再验证越界读写、符号链接、网络、子进程、超时、内存、CPU、目录配额、输出洪泛、取消及伪造回执。[Windows 专项](../tests/windows-sandbox.test.ts)另外验证实际 Node/Electron、正在运行时取消和清理。[跨平台工作流](../.github/workflows/sandbox-boundaries.yml)必须在各原生系统执行，任一缺失/失败都不能算通过。

平台原理参考：[bubblewrap](https://github.com/containers/bubblewrap)、[Linux seccomp](https://man7.org/linux/man-pages/man2/seccomp.2.html)、[Windows AppContainer](https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation)、[Job Object 资源限制](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information)。
