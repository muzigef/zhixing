# 外部工具连接

在桌面选择学习主题，打开「课程与资料 → 外部工具 · MCP」。填写 JSON 配置、确认信任后保存，再点「测试连接」。测试只发现和校验工具，不调用业务工具。启用后，勾选「本会话使用已配置的外部工具」的当前主题对话可以通过 `discover_tools(external)` 使用配置中列出的工具；停用对后续执行生效。

```json
[
  {
    "id": "local-notes",
    "enabled": false,
    "consent": "local-process-and-topic-inputs",
    "command": "/absolute/path/to/node",
    "args": ["/absolute/path/to/notes-server.mjs"],
    "tools": [
      { "name": "search", "risk": "read", "replaySafe": true },
      { "name": "save_note", "risk": "write", "replaySafe": false }
    ]
  }
]
```

`command` 必须是绝对路径；参数单独列在 `args`，不经过 shell。只连接自己信任的本机服务：该进程以用户权限运行，服务本身可能访问文件或网络，不属于代码实验沙箱。知行使用临时工作目录和最小环境，不继承模型密钥、登录信息、`NODE_OPTIONS` 或用户主目录变量。当前不提供 MCP 密钥、OAuth 或 HTTP 配置；不要把凭据写入参数。

配置按主题保存，最多四个服务、每服务二十个已授权工具。`read` / `write` 与重放许可由配置决定，不采用服务器自报的权限提示。外部工具不参与只读并行。写入经过具体操作审批；「本会话允许」仅复用该版本工具的相同参数。撤回或配置变化使旧授权失效；若操作可能执行但没有可靠结果，停止自动重放，需要先到服务侧核对。连接配置或输入 schema 改变会改变工具标识，旧审批不能用于新工具。备份恢复后所有外部连接均停用。

实现支持 stdio 的 `2026-07-28` 发现与逐请求元数据，以及 `2025-11-25` 初始化兼容。新版可识别错误不会降级初始化；旧服务的未知方法错误或发现超时才进入旧流程。协议依据：[stdio](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)、[发现](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)、[旧版生命周期](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)。

当前支持文本工具结果及结构化 JSON；不支持图片、资源、提示、采样、订阅或多轮 `input_required`。工具目录有分页、去重及数量限制。输入与已声明输出 schema 使用独立工作线程中的 Ajv 2020-12 验证，包含常用格式校验；未知格式、远程引用和不支持的 schema 明确拒绝，不忽略验证失败。编译、校验、连接与调用各有时限。[Ajv 版本说明](https://ajv.js.org/json-schema.html#draft-2020-12-breaking)

连接按需建立：普通问答不启动外部进程；只有发现 external 工具或续接相关任务时加载目录。目录按主题、服务配置修订和目录哈希缓存五分钟，缓存命中时不启动服务；实际校验/调用前仍建立新连接，核对输入/输出 schema 和配置，改变时拒绝原调用并刷新缓存。目录缓存不是常驻服务池，也不授予权限。

冷发现可同时初始化当前已启用的最多四个服务，每个连接仍有八秒上限；业务工具依然不参与并行。结束或等待审批时关闭已建立连接。单个连接失败会提供不可用状态，其他学习查询可继续。标准错误输出不保存，协议错误只显示通用原因；正常工具内容仍应由可信服务控制，协议不能证明服务内容不含敏感信息。

验收使用仓库 `tests/fixtures/mcp-server.mjs` 的真实本地子进程，包含实际 Agent 的发现、审批、重启与一次写入。没有连接未指定的真实第三方服务；实际服务的可用性需要按其工具契约测试。当前证据见 [0.6 实施记录](evidence/agent-architecture-next.md)，P1/P2 原记录保留追溯。

## 未知写入的核对

桌面对话中的「任务详情」提供服务核对和用户观察入口；CLI 使用 `/task verify` 或 `/task report`。不会重新执行未知写操作来猜测结果。服务提供状态查询时，在写工具配置中添加：

```json
{
  "name": "save_note", "risk": "write", "replaySafe": false,
  "reconcile": {
    "tool": "operation_status", "argument": "operationId", "identity": "operationId",
    "resultIdentity": "operationId", "status": "status",
    "succeeded": "succeeded", "notExecuted": "not_found"
  }
}
```

同时配置 `operation_status` 为 `read`、`replaySafe: true`。`identity` 取原写请求顶层字段，`argument` 是只读查询参数，结果顶层 `structuredContent` 的 `resultIdentity` 必须精确相等，`status` 必须匹配两种明确状态。只有服务保证 `not_found` 表示从未执行时，才这样配置；最终一致服务的暂未查到不能证明未执行。配置/schema 改变、身份不匹配、结果未定或取消时均保留未知状态。

用户自报保留说明并明确标记未核验，不伪造原工具成功响应。选择结束也不会撤销服务侧操作；恢复后同工具的写入需重新批准。任务详情可修订目标、查看旧计划和累计用量；每个执行段仍保持原有预算。
