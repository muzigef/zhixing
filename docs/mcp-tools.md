# 外部工具连接

在桌面选择学习主题，打开「课程与资料 → 外部工具 · MCP」。填写 JSON 配置、确认信任后保存，再点「测试连接」。测试只发现和校验工具，不调用业务工具。启用后，允许学习上下文的当前主题对话可以通过 `discover_tools(external)` 使用配置中列出的工具；停用对后续执行生效。

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

配置按主题保存，最多四个服务、每服务二十个已授权工具。`read` / `write` 与重放许可由配置决定，不采用服务器自报的权限提示。外部工具不参与只读并行。写入经过已有具体操作审批；若操作可能执行但没有可靠结果，停止自动重放，需要先到服务侧核对。连接配置或输入 schema 改变会改变工具标识，旧审批不能用于新工具。备份恢复后所有外部连接均停用。

实现支持 stdio 的 `2026-07-28` 发现与逐请求元数据，以及 `2025-11-25` 初始化兼容。新版可识别错误不会降级初始化；旧服务的未知方法错误或发现超时才进入旧流程。协议依据：[stdio](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio)、[发现](https://modelcontextprotocol.io/specification/2026-07-28/server/discover)、[旧版生命周期](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)。

当前支持文本工具结果及结构化 JSON；不支持图片、资源、提示、采样、订阅或多轮 `input_required`。工具目录有分页、去重及数量限制。输入与已声明输出 schema 使用独立工作线程中的 Ajv 2020-12 验证，包含常用格式校验；未知格式、远程引用和不支持的 schema 明确拒绝，不忽略验证失败。编译、校验、连接与调用各有时限。[Ajv 版本说明](https://ajv.js.org/json-schema.html#draft-2020-12-breaking)

连接在每次受授权任务开始时建立、结束或等待审批时关闭，目前没有常驻服务池。启用较慢的服务会增加启动延迟；单个连接失败会提供不可用状态，其他学习查询可继续。标准错误输出不保存，协议错误只显示通用原因；正常工具内容仍应由可信服务控制，协议不能证明服务内容不含敏感信息。

验收使用仓库 `tests/fixtures/mcp-server.mjs` 的真实本地子进程，包含实际 Agent 的发现、审批、重启与一次写入。没有连接未指定的真实第三方服务；实际服务的可用性需要按其工具契约测试。证据见 [P1/P2 实施记录](evidence/agent-p1-p2-20260907.md)。
