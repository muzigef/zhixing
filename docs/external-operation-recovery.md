# 外部操作身份、幂等与恢复

2026-09-18。所有 MCP 写操作仍需授权；断线、超时和取消后的结果未知操作不自动重放。服务宣称幂等，也不将工具自动改成 replaySafe。

配置的写工具可增加 `idempotency: { argument: "operationKey" }`。该字段必须是服务输入 schema 的顶层 string。公开给模型的 schema 去掉这个字段；应用验证/派发时用主题、任务 ID、持久调用 ID 和完整工具绑定生成稳定 SHA256 键。模型传入同名字段会拒绝，缺少任务/调用身份也会拒绝；新任务有不同键。服务必须自行保证相同键的去重和载荷冲突检查，应用生成键不证明服务兑现了承诺。

`reconcile` 指向已配置的只读、可安全查询工具。使用幂等键时，其 identity 必须指向同一宿主字段；恢复使用原执行记录重新生成该键。响应必须 structuredContent、身份一致、状态属于配置的 succeeded/notExecuted，且不得 isError。旧配置仍可用其显式 identity 字段，回执会标识 configured_field，不冒充宿主唯一操作身份。

可选 `resultRequestHash: "requestHash"` 要求查询结果同时回报原始线载荷的规范化 JSON SHA256：递归按 JavaScript 字符串键序排序，再按 JSON.stringify 序列化，数组顺序和值不改变，包含宿主操作键。匹配后记录 requestHashVerified；未配置则明确 false。服务实现应按此协议持久绑定操作与载荷，不应返回新查询输入的哈希代替原写请求。

失败、缺字段、身份/请求不符、仍处理中或配置改变均保持未知。核验成功只证明配置查询所返回的这份状态，不能还原丢失的原响应或证明服务本身诚实。人工报告保持未验证，后续写入仍需明确授权。

路径：`mcp-operation.ts` 由立即加载和惰性加载两种入口共用，`mcp-recovery.ts` 与派发复用操作身份规则。实际本地服务测试在 `task-continuity.test.ts`，断线后仅发一次状态查询，原写只执行一次。
