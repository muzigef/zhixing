# 知行前台开发任务清单

> 执行方式：AI 不后台运行。每次前台执行从首个未完成项开始；完成后更新本文件、Evidence，并运行 `npm run verify`。
> 状态：`[x]` 已验证，`[~]` 基础实现/待收口，`[ ]` 未开始。
> 历史 P0 分解见 [P0 自动执行 Tasklist](docs/p0-tasklist.md)。

## P0：MVP 验收收口

- [x] E01–E06：Day 输出契约、Review、继续、源码导读，含隔离根目录 CLI 端到端覆盖。
- [x] E07/E10/E12：Run 取消、完整工具事件审计、LoopGuard 接入 Runtime，含 RunManager/CLI 审计与 Runtime 边界覆盖。
- [x] E08：路径与符号链接越界拒绝。
- [x] E09：Skill 坏文件 fail-closed 与旧 catalog 保留。
- [x] E11：Provider unavailable 降级到 mock 的 Runtime 接入，含 CLI fallback 覆盖。
- [x] E13–E16：主题隔离、跨主题前置、全部进度与 session 恢复，含 CLI 覆盖。
- [x] E17–E20：Keychain、DeepSeek/Codex、角色路由、模型列表/状态与 fallback，含 CLI 覆盖。
- [x] E21–E29：资料导入、引用、失败分类、恢复状态、文件/页数/主题配额与 citation 完整性评估。
- [x] E30：资料/记忆删除影响预览、备份预览与受 `--确认` 保护的恢复 CLI。
- [x] E31：纯本地与资料外发确认门，含 CLI 端到端覆盖。

## P1：学习产品体验

> 可执行分解见 [P1 自动执行 Tasklist](docs/p1-tasklist.md)，按其顺序自动推进。

- [x] 完整 Topic Plan 解析：逐 Day `requiredEvidence`、时长、可选项。
- [x] 课程内容、实验卡、失败案例与证据模板完善。
- [x] Skill 按需加载到 tutor/reviewer/lab 工作流。
- [x] 自然语言 grounded answer 的 CLI 端到端流程。
- [x] 计划调整、复习计划、评分驱动复习优先级与基础间隔重复。
- [x] Session snapshot、恢复与历史裁剪。

## P2：第二阶段

- [x] OCR 与低置信度页。
- [x] SQLite 向量兼容表、混合检索与重排序（不使用 sqlite-vec 扩展）。
- [x] macOS OS sandbox 受限执行边界（Docker 非依赖）。
- [x] loopback Web/SSE、主题隔离同步契约。

## P3：个性化学习

- [x] P3-01：每主题学习画像、待确认个性化计划、资料概览、Skill 草案与显式启用。
- [x] P3-02：模型无关的本地学习建议；可选外发建议只发送画像和资料文件名。
- [x] P3-03：模型审计记录实际执行的 Provider 及受控 fallback。

## 当前前台下一项

**P0–P3 已完成。真实 Provider smoke 是用户可选验收，不是本地功能发布阻塞项；后续工作应从新的产品需求建立任务。**
