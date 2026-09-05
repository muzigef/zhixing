# Pi 项目约束部署

## 已部署组件

- `AGENTS.md`：仓库开发会话和从仓库启动 Pi 时的项目指令；桌面使用 `desktop/runtime-AGENTS.md` 的运行副本。
- `.pi/extensions/zhixing-guard.ts`：工具调用前的强制守卫。
- `.pi/settings.json`：关闭安装遥测、禁用图片发送、禁用 Provider 内层重试。

## 强制守卫规则

守卫在 Pi 的 `tool_call` 事件运行，对显式命中以下规则的调用返回拒绝。路径判断是词法检查，不是完整文件系统隔离：

- `write` / `edit` 的显式 `path` 若位于工作目录外，或路径分段命中 `.pi`、`.git`、`.env`、`.ssh`、`.codex`、`auth.json`、`credentials`、`keychain`、`node_modules` 等列表，会被拒绝。
- `read` 等含字符串 `path` 的工具采用同类检查；没有 `path` 字段的参数不经该路径分支校验。
- `bash` 与 `user_bash` 使用命令字符串白名单/黑名单，允许指定项目脚本与部分只读检查，拒绝命中的网络、凭据、删除、权限变更和 Git 写命令；不对所有命令参数另作文件系统范围校验。
- 直接路径分段命中 `inbox/`、`data/`、`db/`、`learning-notes/` 会被拒绝；产品要求资料由受控 Runtime 导入。守卫本身没有 `realpath`/`lstat` 检查，不能据此保证符号链接解析后的路径隔离，也不能保证覆盖所有敏感文件名变体。
- 被阻止的调用仅记录规则名与工具类型到 `data/audit/pi-guard.jsonl`，不记录参数或敏感内容。
- 知行应用的 live Provider adapter 在已配置时默认可用；`ZHIXING_ALLOW_LIVE_PROVIDER=0` 必须显式禁止调用。该开关不影响 Pi 自身使用 Codex 开发。

这不限制人类在终端直接执行命令，也不等同于操作系统隔离。需要防御恶意扩展或任意本机进程时，应在容器/OS sandbox 中运行 Pi。

CLI 的 `PathPolicy` 对其受控 Store 路径另有符号链接检查，不应混同为 Pi 守卫的实现。桌面和 `PiCodexClient` 的文本模型调用使用空工具列表，因此不把上述开发工具守卫当成允许模型访问本机文件的依据。

## 启动方式

首次进入项目时使用：

```bash
# 在仓库根目录执行；CLI 开发入口需要系统中已有 pi 命令
./scripts/pi-safe.sh
```

安全启动器固定 `--approve --no-extensions -e ./.pi/extensions/zhixing-guard.ts`：它不加载未知全局/项目 Extension，只显式加载已审查守卫。`--approve` 只对本次运行信任项目资源；若要持久启用，在交互式 Pi 中执行 `/trust`，然后重启 Pi。不要绕过启动器，也不要使用 `--no-context-files` 或 `--no-approve`。

使用 Pi 原生 `/login` 选择 OpenAI Codex Provider；不要让模型通过 `bash` 调用 `codex` CLI。原生 Provider 的模型工具调用才能被本项目 Extension 拦截。

## 模型接入与桌面差异

CLI 的 `PiCodexClient` 通过本安全启动器调用 Pi，额外传入 `--no-tools --tools ''`、关闭 Skill/模板加载、stdin 请求、临时无持久会话和 JSON 文本模式。偏好只读取非敏感的 Provider、模型、推理强度；认证由 Pi 管理。

桌面将同一守卫编译后随应用附带，通过 Electron 的 Node 模式运行内置 Pi 0.80.7，无需系统 bash/Node/Pi。工作目录为系统应用目录下的 `runtime`，加载专用对话指令，不加载仓库开发指令。两种模型入口都禁用模型工具；`--offline` 用于避免启动更新等请求，不代替 `ZHIXING_ALLOW_LIVE_PROVIDER=0`。

Pi 配置存在不证明认证可用；当前 P9 真实登录尚待恢复。详细配置与登录步骤见 [配置](CONFIGURATION.md#pi-codex-接入)，已验证范围见 [Pi 证据](evidence/pi-codex-integration.md) 和 [桌面证据](evidence/desktop-app.md)。

## 历史启动验证

- Pi 在 `--approve --no-session --no-tools` 下成功加载项目资源并返回 `GUARD_READY`。
- 仅允许 `bash` 的负向 smoke 请求 `curl` 时，未发生网络调用；模型返回项目限制提示。

该 smoke 证明项目规则被模型读取、守卫在禁用未知 Extension 时仍可加载；工具拦截逻辑已由 P0 的可控 mock ToolCall 与 CLI 覆盖补充验证。
