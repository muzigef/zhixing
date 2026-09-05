# DeepSeek 最小真实 Smoke

> 历史证据：下文的测试数量、命令输出、提交状态、机器配置和“当前”均指本阶段记录时。2026-09-05 文档核对保留这些历史结果；现行功能与配置见 [功能验收](../features-and-acceptance.md)、[配置](../CONFIGURATION.md)，后续阶段见 [证据索引](README.md)。

> 状态：通过

## 授权范围

用户明确授权一次最小真实 DeepSeek 请求。请求只发送固定文本 `Reply with exactly DEEPSEEK_SMOKE_OK.`，未发送 PDF、Chunk、学习记录、记忆、路径或 API Key。

## 执行结果

```text
DEEPSEEK_SMOKE_OK
```

首次本地 smoke 命令在请求前因 `tsx -e` 顶层 await 转译失败退出，未产生网络请求。随后使用 async IIFE 重试并成功。

## 结论

macOS Keychain -> DeepSeekClient -> OpenAI-compatible DeepSeek endpoint 的最小连通性已验证。该记录不改变当前 Provider 策略：已配置 Provider 默认可用，`ZHIXING_ALLOW_LIVE_PROVIDER=0` 会禁止真实调用；不同命令的用户材料范围见 `CONFIGURATION.md`。
