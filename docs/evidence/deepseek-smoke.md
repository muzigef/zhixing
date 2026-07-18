# DeepSeek 最小真实 Smoke

> 状态：通过

## 授权范围

用户明确授权一次最小真实 DeepSeek 请求。请求只发送固定文本 `Reply with exactly DEEPSEEK_SMOKE_OK.`，未发送 PDF、Chunk、学习记录、记忆、路径或 API Key。

## 执行结果

```text
DEEPSEEK_SMOKE_OK
```

首次本地 smoke 命令在请求前因 `tsx -e` 顶层 await 转译失败退出，未产生网络请求。随后使用 async IIFE 重试并成功。

## 结论

macOS Keychain -> DeepSeekClient -> OpenAI-compatible DeepSeek endpoint 的最小连通性已验证。此证据不表示用户资料可以外发；包含用户资料的请求仍必须经过 `external_content_confirmation_required` 确认门。
