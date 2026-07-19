# 当前产品决策

> 本文记录已生效的运行契约；历史排期不覆盖本文。交付状态见 `TASKS.md`。

## 主题与本地数据

- 内置主题为 `agent-development`、`rag`、`tool-calling`、`interview-project`；用户可创建额外的受控本地主题。
- 主题间默认隔离：计划、进度、资料、记忆、审计与教学 session 都以 `topicId` 为边界。
- 当前主题、本地路由、用户创建主题与学习记录都是本地状态，均不应提交到 Git。
- 当前支持删除资料与记忆、手动备份/确认恢复数据库；尚不支持主题删除、自动备份、导出或云同步。

## Provider 与隐私

- 角色 `tutor`、`reviewer`、`lab` 初始路由为 `mock`，可独立切换至 `deepseek-api` 或 `codex-cli`；路由保存在本地设置。
- 已配置的真实 Provider 默认可用；`ZHIXING_ALLOW_LIVE_PROVIDER=0` 会禁止真实调用。
- DeepSeek API Key 仅存于 macOS Keychain；Codex 使用用户已登录的官方 CLI。知行不读取、保存、导出 Cookie、token 或认证文件。
- 资料问答发送检索证据；学习建议发送画像与资料名称；教学和自然交互仅发送当前主题受限上下文。审计不保存 prompt、回答或凭证。
- 明确选择 Provider 的教学/自然交互失败时显示错误，不会静默改由 mock；允许 fallback 的调用可降级。

## 学习、资料与记忆

- Day 完成由确定性证据 Review 控制，模型不能自行推进计划。
- 支持 PDF/Markdown、本地 OCR、FTS5 与本地 HashEmbedding 混合检索；当前不支持 DOCX、sqlite-vec 或云端 embedding。
- 单文件上限 250 MB、PDF 上限 500 页、单主题资料上限 2 GB；当前为代码常量。
- 当前长期记忆只能由 `记住 <内容> --确认` 写入；reviewer 或 RAG 自动写记忆尚未接入。

## 运行与质量

- Node 版本固定为 `24.8.x`，SQLite 使用 `better-sqlite3`。
- Codex 调用为只读、临时、无审批的 `codex exec --json` 文本流；DeepSeek 使用 SSE。
- `npm run verify` 是本地发布质量门；真实 Provider smoke 为可选环境验收。
