# Pi 项目约束部署

## 已部署组件

- `AGENTS.md`：每轮模型调用的项目指令、开发顺序、隐私和停止条件。
- `.pi/extensions/zhixing-guard.ts`：工具调用前的强制守卫。
- `.pi/settings.json`：关闭安装遥测、禁用图片发送、禁用 Provider 内层重试。

## 强制守卫规则

守卫在 Pi 的 `tool_call` 事件运行，模型不能通过普通工具调用绕过以下规则：

- `write` / `edit` 只能修改当前 `zhixing/` 项目内、非 `.pi`、`.git`、`.env`、`.ssh`、`.codex`、`auth.json`、`node_modules` 的路径。
- `read` 等带路径工具不能读取项目外或敏感路径。
- `bash` 仅允许项目验证命令和只读检查命令；阻止网络、`codex` CLI、凭证、删除、权限变更、Git 写操作和依赖安装命令。
- 模型工具不能直接读取或写入 `inbox/`、`data/`、`db/`、`learning-notes/`；资料只能由受控 Runtime 本地导入，审计不能被模型篡改。
- 被阻止的调用仅记录规则名与工具类型到 `data/audit/pi-guard.jsonl`，不记录参数或敏感内容。
- 知行应用的 live Provider adapter 必须通过 `ZHIXING_ALLOW_LIVE_PROVIDER=1` 显式解锁；该开关不影响 Pi 自身使用 Codex 开发。

这不限制人类在终端直接执行命令，也不等同于操作系统隔离。需要防御恶意扩展或任意本机进程时，应在容器/OS sandbox 中运行 Pi。

## 启动方式

首次进入项目时使用：

```bash
cd zhixing
./scripts/pi-safe.sh
```

安全启动器固定 `--approve --no-extensions -e ./.pi/extensions/zhixing-guard.ts`：它不加载未知全局/项目 Extension，只显式加载已审查守卫。`--approve` 只对本次运行信任项目资源；若要持久启用，在交互式 Pi 中执行 `/trust`，然后重启 Pi。不要绕过启动器，也不要使用 `--no-context-files` 或 `--no-approve`。

使用 Pi 原生 `/login` 选择 OpenAI Codex Provider；不要让模型通过 `bash` 调用 `codex` CLI。原生 Provider 的模型工具调用才能被本项目 Extension 拦截。

## 已验证

- Pi 在 `--approve --no-session --no-tools` 下成功加载项目资源并返回 `GUARD_READY`。
- 仅允许 `bash` 的负向 smoke 请求 `curl` 时，未发生网络调用；模型返回项目限制提示。

该 smoke 证明项目规则被模型读取、守卫在禁用未知 Extension 时仍可加载；工具拦截逻辑已由 P0 的可控 mock ToolCall 与 CLI 覆盖补充验证。
