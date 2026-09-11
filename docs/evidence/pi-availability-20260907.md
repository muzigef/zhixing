# Pi Codex 登录后可用性验证

> 历史验收快照：下文的测试数量、失败、安装及“待验”状态仅适用于记录当次执行；未重新运行或改写历史结果。当前实现与后续进展见 [当前状态](../current-status.md) 和 [证据索引](README.md)。

日期：2026-09-07。用户已在 Pi 登录 Codex 订阅账号后授权验证。没有修改产品代码、模型配置或凭据；所有请求均经知行现有 Pi 接口，未切换其他 Provider。测试只使用临时合成工作区和新会话，认证由 Pi 自己处理。

**结论：Pi Codex 的真实文本请求，以及桌面包中的只读工具调用与模型续写均已成功。** 当前模型为 `gpt-5.6-terra`，Pi 设置为 `medium`，知行档位为 `balanced`。这消除了此前“Pi 真实调用尚未通过”的连接阻碍，不代表已完成完整质量评测或长期稳定性验收。

| 检查 | 首个模型文本 | 总耗时 | 结果 |
| --- | --- | --- | --- |
| SDK R01 第一次独立问答 | 3.452 秒 | 10.674 秒 | completed，完整两段回答 |
| SDK R01 第二次独立问答 | 3.203 秒 | 10.785 秒 | completed，完整两段回答 |
| 0.4.0 安装包：2+2 | 4.161 秒 | 7.482 秒 | completed，准确返回 4 |
| 0.4.0 安装包：先调用 learning_progress，再回答当前学习日状态 | 39.074 秒 | 42.587 秒 | 2 个模型回合、1 次实际工具调用，返回 D01 进行中，与临时工作区一致 |

“首个模型文本”不包含先发生的工具调用。工具往返明显更慢；这些是本次样本，不能推断长期延迟、额度或其他模型的可用性。没有使用写入工具，也没有验证完整实验生成/运行、所有质量用例或 CLI 的旧文本适配器。

原始非敏感结果及 usage 见 [JSON 记录](pi-availability-20260907.json)。SDK 检查命令：

```bash
npm run eval:quality -- --live --provider=pi-codex --reasoning=balanced --case=R01 --output=/tmp/zhixing-pi-login-check-20260907.json
```

桌面验证用 Playwright 直接启动 `desktop/release/mac-arm64/知行.app/Contents/MacOS/知行`，使用独立 `ZHIXING_DESKTOP_TEST_DATA`，Pi 沿用原登录配置。通过受控 IPC 新建会话，发送真实请求，等待 settled 事件后读取完成结果；第二项仅在临时工作区开始 agent-development/D01，再授权该合成主题上下文查询。测试结束关闭实例并清理临时学习数据。首次验证脚本提前结束等待，已修正为等待 settled 后重新执行；该脚本中断不计作模型失败或成功样本。

本次仅追加验收记录与状态说明，产品代码未改；未重跑全套桌面 UI、打包、依赖审计或全量真实质量集。

记录更新后的 `npm run verify` 退出 0，包含 lint、双类型检查、336 个 Vitest 测试、integration、eval、mock smoke、敏感内容及 diff 空白检查。日志：`/tmp/zhixing-pi-availability-verify-20260907.log`。
