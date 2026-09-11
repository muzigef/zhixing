# 0.4.1 Pi 延迟优化与验证

> 历史验收快照：下文的测试数量、失败、安装及“待验”状态仅适用于记录当次执行；未重新运行或改写历史结果。当前实现与后续进展见 [当前状态](../current-status.md) 和 [证据索引](README.md)。

2026-09-07，依据用户“评估优化，并执行和验证”。分析基线见 [原因报告](pi-latency-analysis-20260907.md)。

## 实施评估

采用已由真实对照证明的 SSE 短生命周期方案，保留当前 Pi 模型和思考强度。继续保留独立 worker 及完整 Provider 协议/退出码检查，不通过忽略退出错误或提前执行工具来提高速度。

本轮未采用常驻 worker：它改变会话隔离、取消、崩溃恢复及认证生命周期；SSE 已消除主要的每轮关闭等待。后续是否实施以分阶段计时反映的准备/握手占比及质量回归为依据，未将其标成已实现。未对自然语言问题增加硬编码关键词绕过模型，也未以低思考强度代替连接修复。

## 实现

- 桌面 Pi 默认 `sse`。`PiApplicationOptions.transport` 或启动环境 `ZHIXING_PI_TRANSPORT=auto` 可显式对照；无效配置在启动 worker 前失败，不静默回退到其他模型。
- 仅模型 SDK worker 输出白名单阶段及数字计时：SDK 准备、请求至首事件/首文字/完成；adapter 在成功退出后补齐偏好解析、总耗时、完成后收尾。计时不混入 Provider 历史，不包含正文或认证数据。
- 每条助手消息最多保存六轮 `modelTimings`，旧会话字段可缺失；额外统计实际 ToolHarness 耗时。设置诊断按模型、思考强度和传输策略分组。
- 首事件不等于首字；requestMs 包含认证解析、网络和远端处理，不叫“纯推理时间”。未提供的推理/缓存用量保留未知。
- 生成状态直接展示模型准备、等待内容、准备工具和收尾。工具准备不等于执行，不展示内部思考文本。
- 学习进度工具返回 `topicId`、`activeDay`、`state`、`prerequisiteBlockers`，避免将 `rag` 主题 ID 误当作学习日；CLI 的可读进度命令仍由现有 Runtime 处理。
- 实包发现自然进度问题仍重复查询后，调整回答指令：本轮新读的应用上下文已足够时直接使用；需要补充、重新刷新或用户明确要求工具时仍调用。三次自然查询的真实回归均为一轮、零工具；明确工具请求仍执行一次。
- 桌面版本更新为 0.4.1，配置、使用指南和测试说明同步。

## 真实合成复测

生产源码使用 `gpt-5.6-terra` / 均衡档位。每种任务三次，独立临时会话；RAG 夹具明确为尚未开始。全部六次回答及九轮模型请求完成。数字答案均为 4；工具答案均正确说明没有当前学习日、尚未开始及前置条件，未把 rag 称为学习日。

| 任务 | 历史 auto 完成中位数 | 本轮正式 SSE 完成中位数 | 本轮范围 |
| --- | ---: | ---: | ---: |
| 数字问答 | 6.080 秒 | 3.722 秒 | 3.116–4.517 秒 |
| 进度工具续答 | 14.362 秒 | 6.473 秒 | 5.967–6.483 秒 |

九轮完成后收尾约 0.35 秒，已不再出现原 WebSocket 每轮约 3.2 秒的收尾等待。本轮结构化工具结果与历史字符串结果不同，且远端负载未控制；总耗时是小样本观察，不是固定提速保证。首字仍受远端等待影响。

命令：

```bash
node_modules/.bin/tsx scripts/profile-pi-latency.ts --live --repetitions=3 --cases=text-balanced-sse,tool-balanced-sse --output=docs/evidence/pi-latency-fixed-20260907.json
```

原始结果：[正式实现复测 JSON](pi-latency-fixed-20260907.json)。脚本通过正式 transport 参数对照，不修改构建 worker。

## 最终 0.4.1 实包真实验证

通过实际 `.app` 的 IPC 和界面运行，使用独立临时工作区，经产品学习操作创建 `agent-development/D01` 进行中状态；认证由内附 Pi 处理。该夹具与上表尚未开始的 RAG 夹具不同，不合并中位数。

| 任务 | 完成耗时 | 模型轮次 / 工具调用 |
| --- | ---: | --- |
| 数字问答 | 3.262 秒 | 1 / 0 |
| 明确要求实际进度工具 | 8.328 秒 | 2 / 1 |
| 自然进度查询，第 1 次 | 3.174 秒 | 1 / 0 |
| 自然进度查询，第 2 次 | 5.745 秒 | 1 / 0 |
| 自然进度查询，第 3 次 | 3.553 秒 | 1 / 0 |
| RAG/微调两段说明 | 6.700 秒 | 1 / 0 |
| 请求开始后取消 | 0.834 秒，从任务开始计时 | interrupted，未生成正文 |

自然进度查询中位数 3.553 秒；取消一行不是点击停止后的纯取消延迟。七轮成功模型请求的完成后收尾为 0.327–0.355 秒。上述六条回答均复核：数字正确、进度为 D01 进行中、概念比较遵守两段且例子相关；这不代表完整人工教学质量集通过。停止与统计界面通过实际包验证，设置中显示 SSE 和分阶段数字，截图已目视检查。

[最终实包 JSON](pi-latency-packaged-20260907.json)、[诊断界面截图](pi-latency-packaged-20260907.png)。[首次实包 JSON](pi-latency-packaged-initial-20260907.json) 保留发现重复工具查询时的数据，其中自然进度问题为两轮/一次工具、7.259 秒；它不是最终提示规则的验收结果。

```bash
ZHIXING_DESKTOP_EXECUTABLE='/path/to/知行.app/Contents/MacOS/知行' node desktop/scripts/check-pi-latency.mjs --live --output=/tmp/zhixing-package-live.json
```

## 自动化及安装包验收

- 测试先行：SSE 默认/显式 auto、实际 worker 对接假公共 SDK、白名单阶段、不转发思考、计时持久化及 unknown 用量在实现前出现预期失败；实现后定向通过。
- 协议边界：缺少 done、done 后事件、失败退出、负计时均不会执行已缓冲工具；取消和超时路径通过。
- 进度工具：前置阻塞/未开始、D01 进行中、非法主题通过。
- CLI 集成测试在全量并发时两次触发原有 5 秒总超时，单独运行通过；该测试启动三个实际 CLI 进程。已将每个 execFile 明确限制为 4 秒，并据子进程数量设置 15/10/14 秒测试预算，保留全部断言。它不改变生产超时。
- 最终 `npm run verify` 通过：76 个测试文件、347 个测试，lint、两套类型检查、integration、eval、mock smoke、敏感信息和空白检查；日志 `/tmp/zhixing-latency-fix-verify-release.log`。
- 三套开发 UI 通过；最终安装包三套 UI 再次通过，覆盖 Pi/DeepSeek 切换、流式输出/停止、队列与恢复、资料/证据、授权和备份。日志 `/tmp/zhixing-latency-dev-ui.log`、`/tmp/zhixing-latency-package-ui-final.log`。
- 最终实际包真实验证通过上述七项任务；本轮未重新测试真实 DeepSeek API。
- `CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist:mac` 完成，DMG 的 `hdiutil verify` 通过，SHA-256 生成。安装器未签名/公证，不自动安装到用户 Applications，不随 Git 源码提交。

安装器：`desktop/release/Zhixing-0.4.1-mac-arm64.dmg`。

```text
70bd7cb852562fb809c2c59cf161bff8b33d37ba87f661a0a7cbb6ceb86175cb  Zhixing-0.4.1-mac-arm64.dmg
9925a5b949e021e4b489e0f54c776fa9313f2fa8e8dcb51b1f51dea68f6b3715  Zhixing-0.4.1-mac-arm64.zip
```

## 边界

不能保证消除远端首内容长尾。常驻连接、通用工具并行和长回答增量排版仍是条件性优化。Windows、Intel Mac 实机、签名公证及远端 CI 未在本轮验收。
