# 真实模型性能测量

2026-09-18。共享测量器 `src/provider-performance.ts` 接受 ModelClient 或官方 AgentExecutor，使用固定公开的 2+2 短提示，不发送会话、学习资料或工具。每周期先新建一个客户端，再复用它调用一次；1–3 个周期，共 2–6 次请求，每次最多 60 秒、1000 个可见字符，API 输出上限 2048 tokens。官方运行时只能控制可见字符/时限，token 不是硬上限。

```bash
# 官方 Codex，显式真实调用；输出文件必须不存在
node --import tsx scripts/benchmark-provider-performance.ts --live --provider=native-codex --cycles=2 --output=new-native-performance.json
# 确定性离线流程检查，不说明网络或模型性能
node --import tsx scripts/benchmark-provider-performance.ts --provider=demo --cycles=1 --output=new-demo-performance.json
# 通过签名桌面应用使用已配置的系统加密凭据
node desktop/scripts/benchmark-provider.mjs --live --provider=deepseek-api --cycles=2 --output=new-api-performance.json
```

桌面脚本支持 Codex、Pi、DeepSeek、Kimi、demo；默认使用安装包，测当前构建应设置 `ZHIXING_DESKTOP_EXECUTABLE`。它强制隔离工作区并记录包哈希；API Key 仅由主进程安全存储处理。主进程有严格 `provider-benchmark` IPC，预算受共享 schema 限定；允许停止与退出取消。未安装最新实现的包不能冒充当前测量入口。

`fresh_client` 表示新建应用客户端，`reused_client` 表示复用同一个对象；它们不证明机器冷启动或服务端缓存状态。尤其官方执行器每次仍启动受限 CLI，并会重新验证运行时，不能把它说成常驻热进程。准备时间单列，执行器额外校验仍计入总耗时。报告记录构建、模型、传输和固定提示哈希，不能把不同条件直接混在一起。

首事件可能是等待进度或工具准备；首正文只在第一个非空白文字块到达时计时。原生 CLI 当前交付完整消息，因此标注 completed_message；测量器不伪造 firstTokenMs。共享 AgentService 也不会再让首段空白提前启动正文计时，但保持原文空白不丢失。

按组统计计划/尝试/完成/失败/取消/未尝试；耗时的最近秩 P50/P95 仅取完成请求，用量缺失另计，缓存用量未完整报告时显示未知。保存失败阻止继续派发请求。输出仅存固定提示、计量和回答哈希，不把实际回答正文或凭据写入诊断。

桌面诊断现在包含官方运行时，区分首正文与完整消息、P50/P95、未知用量；历史 firstTokenMs 字段为兼容保留，旧记录的首段空白行为不能追溯修正。少量本机样本只用于排查，不构成供应商 SLA、质量或成本优越性证明。
