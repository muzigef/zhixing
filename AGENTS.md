# 知行项目约束

本文件由 Pi 在启动时加载，适用于每次模型调用。它提供行为规则；文件、命令和网络限制由 `.pi/extensions/zhixing-guard.ts` 强制执行。

## 目标与顺序

1. 按 `docs/ai-execution-protocol.md` 的固定顺序完成 P0 切片。
2. 每个切片先写失败/边界测试，再做最小实现。
3. 每个切片至少运行 `npm run lint`、`npm run typecheck`、`npm run test`；触及 CLI、资料库、SQLite、记忆或状态机时，再运行 integration、eval 和 mock smoke。
4. 只能依据真实命令输出报告完成；更新 `docs/evidence/` 记录已验证、未验证和风险。

## 数据与隐私

- 未配置真实 Provider 时使用本地 mock。已配置 Provider 后，`ZHIXING_ALLOW_LIVE_PROVIDER=0` 是禁止外发的总开关；发送内容必须是当前主题的受限上下文，并在调用层标记为用户材料。
- 只允许通过受控 Runtime 从 `inbox/<topicId>/` 显式导入资料；模型工具不得直接读取或改写 `inbox/`、`data/`、`db/`、`learning-notes/`。
- 不得读取、写入、输出或提交 API Key、token、Cookie、认证文件、`.env`、`auth.json`、`.ssh` 或 `.codex` 内容。
- 知行应用的真实 Provider 在已配置时默认可用；设置 `ZHIXING_ALLOW_LIVE_PROVIDER=0` 后 adapter 必须拒绝调用。该开关不影响 Pi/Codex 开发会话。
- 不得删除用户资料、主题、数据库或审计；需要时先报告影响范围并等待用户确认。

## 工程边界

- 只修改当前 `zhixing/` 项目内的实现、测试、主题计划、Skill、文档和非敏感夹具。
- 不执行 git commit、push、reset、clean、外部网络下载、系统权限变更或通过 bash 启动 `codex` CLI。
- 使用 `./scripts/pi-safe.sh` 启动 Pi 原生 Codex Provider；不要将 `codex exec` 当作受 Pi 工具限制的子 Agent。
- 不得使用 `it.skip`、`it.only` 或忽略失败退出码；每个切片完成前运行 `npm run verify`。
- 不因未实现功能而引入 Web、向量库、OCR、多 Agent 或范围外依赖。

## 约束冲突或阻塞

遇到凭证、外发资料、删除数据、提高配额、需要全局安装、三次修复仍失败，或设计冲突时，立即停止并报告：阻塞点、影响、已尝试内容、推荐方案和所需确认。
