# Pi Codex 模型接入

日期：2026-09-05。范围：P9。实现已接入，当前 tutor 路由已切换；真实模型连通性待 Pi 认证恢复后复测。未提交或推送 Git。

## 用户指定与本机配置

用户要求知行使用 Pi 中配置的 Codex，而不是独立 Codex CLI 或另外配置 OpenAI API Key。读取非敏感模型偏好确认：Provider 为 `openai-codex`，模型为 `gpt-5.6-terra`，推理强度为 `medium`。本机 Pi 版本为 0.80.7。

知行 `settings/model-routing.local.json` 的 tutor 已通过 ModelRoutingStore 改为 `pi-codex` 并读回校验；reviewer 与 lab 保持原值 `mock`。该本机设置已被 Git 忽略。没有更改 Pi 默认模型或复制登录信息。

## 实现

- 新增 `src/pi-client.ts`：读取 Pi 的全局/项目默认 Provider、模型与推理强度，每次调用重新解析。项目设置优先，显式指定完整模型选择，拒绝缺失或非 Codex 默认配置。
- 调用本项目 `scripts/pi-safe.sh`，保留已审查守卫和项目上下文，禁用其他扩展发现与全部模型工具。显式空工具白名单覆盖开发启动器原有的工具列表，避免仅加 `--no-tools` 仍保留工具。
- 用户请求通过 stdin 传入；临时 Pi 会话不落盘。凭据解析、登录与刷新由 Pi 处理，知行不读取认证文件。
- 接收 Pi JSON 事件，增量解码 UTF-8，兼容当前累计快照事件与较新版本纯增量事件，忽略推理文本，只显示 assistant 文本。
- 完成必须同时满足 assistant 正常结束、Agent 结束和进程退出码 0；错误、截断、工具请求、模型身份不符均拒绝成功。支持取消与 150 秒超时，约束输出和事件数量。
- Pi stderr 与模型错误原文不外显，常见认证缺失转换为本地登录指引。
- CLI 的 Provider 注册、精确命令、计划白名单和动作确认均识别 `pi-codex`；`npm run test:harness` 纳入 Pi 回归。

协议依据为安装包自带文档/代码与 Pi 官方 [JSON 事件文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md)、[设置文档](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md)。

## 本地验证

先写失败测试，再实现适配和边界处理：

- `tests/pi-client.test.ts`：14 项，涵盖配置覆盖/变更、精确模型/推理参数、stdin、工具禁用、UTF-8 分片、流去重、各种结束原因、模型身份、坏 JSON、输出限额、取消/超时与认证错误。
- `tests/pi-cli.test.ts`：3 项，实际运行知行 CLI 和安全启动器，以本地假 Pi 可执行文件验证路由持久化、自然提问、零退出码错误识别，以及停滞进程取消后继续回答。
- `tests/action-registry.test.ts`：新增 Pi 切换命令确认边界。

真实模型不作为自动化夹具；测试使用临时配置和临时 SQLite，不访问真实用户资料。

最终代码执行 `npm run verify`，退出码 0：**54 个测试文件、267 个测试通过**，较 P8 增加 18 个测试。lint、typecheck、integration（9）、Eval（6）、mock smoke、敏感信息扫描和 diff 空白检查均通过。

```bash
npm run test -- tests/pi-client.test.ts tests/pi-cli.test.ts tests/action-registry.test.ts
npm run verify
```


## 真实连接结果

先通过全量本地检查，再以适配器调用已有 Pi，测试请求仅为计算 2 + 2 并输出数字。模型偏好读取成功，但没有收到任何回答文字。

最后一次确认返回 `pi_login_required`，耗时约 1.46 秒，进程退出码 1。适配器匹配的是 Pi 的“当前 Provider 没有可用调用凭据”错误；没有把完整错误原文、认证内容或网络响应落到日志。此前几次诊断均在约 1.4–1.5 秒内失败。**这属于初始化失败耗时，不是首字延迟或模型生成速度。**

Pi 自身的离线模型列表能列出 `gpt-5.6-terra`，说明配置存在，不能证明本次调用已取得有效认证。尚未验证真实完整回复、实际首字速度或教学质量，不将本切片称为真实连接验收通过。

恢复步骤：通过 `./scripts/pi-safe.sh` 进入 Pi，执行 `/login`，选择 OpenAI Codex 并完成认证，再启动 `npm run repl` 重试。登录可能涉及本人浏览器操作；知行不接收或复制凭据。

## 限制与后续

当前 Pi 适配为文本模式，未接入知行工具调用协议，也未使用常驻 RPC 进程。问答、教学与计划仍使用现有运行时；对话恢复由知行维护。后续先恢复 Pi 认证并验证短问题，再进行固定题集的模型质量和延迟评测。
