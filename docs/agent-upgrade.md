# 桌面学习 Agent 0.3 使用与实现

2026-09-05。本轮在 `e072512` 上实现；执行与验收记录见 [升级证据](evidence/agent-upgrade.md)。定位仍是学习 Agent，保留 Pi Codex 与 DeepSeek；不把界面相似等同于完整编程 Agent 能力。

## 开始学习

1. 顶部选择学习主题，打开“课程与资料”。开始学习日、查看进度，或从系统文件选择器导入 PDF / Markdown。
2. 默认使用应用自己的工作区。需要复用 CLI 数据时，点击“连接现有工作区”，选择 `zhixing` 目录或 CLI 的数据根；两端直接使用同一课程、资料索引和进度，不复制或迁移聊天记录。
3. 勾选“本会话使用学习上下文”后，模型可收到当前主题的进度、当日课程和最多 3 条检索片段。DeepSeek 还可继续调用进度、资料目录与检索工具；Pi 使用应用提供的文本上下文，保持空工具列表。
4. 回答下方的资料按钮展示实际检索来源。新引用含 `chunkId`，能定位长章节深处的原始片段；来源存在不代表回答每句话都已核实。

切换学习主题会新建对话，避免混入上一主题历史。聊天绑定工作区 ID，连接其他工作区后不能继续使用原工作区的上下文；可连回原工作区。

## 连续任务

- 生成时继续输入：Enter 或“排队”追加待办；“立即调整”中断本轮并优先处理新要求，保留目标和已有回答。
- “停止”保留部分回答并暂停队列；重启后须点击“继续待办”，不会自动发送。每段对话最多 10 条待办，可单独撤回。
- “会话选项 → 任务目标与约束”编辑持续目标及偏好，各最多 4,000 字符；切换模型和重启仍保留。
- 较长对话会尝试整理较早内容，摘要独立保存。整理失败时继续使用有界原文片段；完整桌面消息不会因整理而删除。最新明确纠正优先，摘要不作为执行成功的依据。
- 每条回答展示任务进展、用时和首字时间。收到合法完成事件且有回答才记为完成；断流、超时、取消保留不同状态。

CLI 仍保留最近 6 轮作为工作上下文，并额外持久保存初始目标（最多 4,000 字符）。CLI 与桌面聊天格式不同，不自动互相导入。

## 实际证据与 Review

“课程与资料 → 产物与验收”按学习日保存实现、测试报告、失败案例、复盘。可粘贴内容或选择文本/代码文件；原文件不改变。每份产物记录 UUID、种类、SHA-256、字节数和时间；检查时重新读取副本计算哈希，缺失或变化不能作为有效证据。

CLI 等价命令：

```text
提交证据 D01 implementation 实际实现内容或可阅读的实现说明……
提交证据 D01 testOutput 测试输入、观察结果和测试环境……
提交证据 D01 failureCase 失败输入、错误结果与原因……
提交证据 D01 reflection 今天的结论、限制和下一步……
证据列表 D01
检查 D01
```

类型还支持 `testScript`。内容至少 8 个字符、最多 256 KB；每个学习日最多 100 份产物。旧 `--实现 --测试 --失败 --复盘` 参数不再计入证据。Review 检查计划规定的证据完整性，并把产物哈希与来源写入学习日志；8/8 不代表掌握程度或代码质量。自行上传的测试报告始终明确标为“未复跑”。已有学习记录不自动重判或迁移。

macOS 可显式运行提交的 JavaScript 测试。实现使用 ES Module 保存为 `implementation.mjs`，测试脚本保存为 `checks.test.mjs`，使用 Node 的 `node:test` 和 `./implementation.mjs` 导入路径：

```javascript
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { add } from './implementation.mjs';
test('addition', () => assert.equal(add(1, 2), 3));
```

桌面点击“运行提交的测试”，CLI 输入 `运行测试 D01`。实际执行在 macOS `sandbox-exec` 内，临时目录只包含这两份产物，禁止联网、默认禁止其他文件内容读取，10 秒超时，stdout/stderr 分别最多 64 Ki 字符。结果绑定实现和测试脚本的哈希；修改产物后旧结果不会作为当前测试结果。Windows/Linux 暂无已验证的执行沙箱，显示 unavailable；不会降级为无约束执行。测试之后使用“检查完成证据”更新 Day 状态。通过用户自编测试不能证明实现对所有输入都正确。

## 耗时与质量

设置中的“查看本机耗时统计”按 Pi Codex / DeepSeek / demo 分开显示成功、失败、中断、首字 P50/P95、整轮 P50、检索、模型与工具、上下文整理耗时。来源是最近 20 段会话中最多 200 条消息；耗时分位数只统计成功回答。它不采集聊天正文、不调用模型，也不把离线 demo 计入真实模型速度。

`npm run eval:agent` 覆盖实际工具续写、来源隔离、未授权材料、断流、长对话、纠正、排队恢复、产物完整性和诊断。真实内容质量采用 [固定人工评测集](agent-quality-cases.json)，在同样材料、提示、模型设置下记录每项是否达到标准；没有把 mock 断言当成真实模型质量得分。精确 token/成本、语义检索模型和逐句事实核实尚未实现。

## 构建与版本更新

源码启动、UI 回归、打包会先运行 `prepare:runtime`：确保项目内 Electron 二进制存在，并探测/重建 Electron 专用 SQLite。CLI 使用根包自己的 Node SQLite，两个 ABI 不混用。

```bash
npm ci
npm ci --prefix desktop
npm run verify
npm run eval:agent
npm --prefix desktop run test:ui
CSC_IDENTITY_AUTO_DISCOVERY=false npm --prefix desktop run dist:host
npm --prefix desktop run checksums
```

`dist:host` 在 macOS 生成当前架构 DMG/ZIP，在 Windows 生成当前架构 NSIS。`dist:mac` 固定 arm64；跨平台包必须在相应构建机执行。`desktop-release.yml` 通过手动触发或 `v*` tag 在 macOS/Windows 构建、运行开发及实际包 UI，并上传安装器和 SHA-256；tag 构建成功后创建 GitHub draft release，供维护者检查后发布。当前流水线生成未签名预览包，Developer ID/公证和 Windows 签名仍需真实证书与平台验收。

设置里的“检查新版本”仅在点击后访问 GitHub 公开 Releases 元数据，校验版本与项目地址，提供发布说明链接；不会自动下载或替换应用。[GitHub Releases API](https://docs.github.com/en/rest/releases/releases#get-the-latest-release) 是该查询接口的官方依据。此检查也遵守应用禁外发开关。未公开正式 release 时显示暂无公开版本。
