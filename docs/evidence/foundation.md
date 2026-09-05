# 基础实现验证记录

> 历史证据：下文的测试数量、命令输出、提交状态、机器配置和“当前”均指本阶段记录时。2026-09-05 文档核对保留这些历史结果；现行功能与配置见 [功能验收](../features-and-acceptance.md)、[配置](../CONFIGURATION.md)，后续阶段见 [证据索引](README.md)。

> 状态：历史基础验证快照；后续阶段见 [开发计划](../development-plan.md) 与各阶段 Evidence。

## 已实现

- TypeScript ESM CLI 与主题注册表。
- 四个首批主题及三个新增主题的 `PLAN.md`。
- `topicId` 路径隔离与主题学习日记录创建。
- SQLite 文档/Chunk/FTS5/记忆表。
- Markdown 导入、哈希去重、主题内 FTS5 检索与引用元数据。
- 已确认来源的记忆写入和主题内软删除。
- Mock 模型及取消测试。

## 验证命令与结果

```text
npm run lint       # pass
npm run typecheck  # pass
npm run test       # 2 files, 7 tests passed
npm run smoke:mock # 输出 4 个首批主题
```

## 已覆盖的边界

- 非法 `..` 路径拒绝。
- 资料和检索的 `topicId` 隔离。
- 同主题文件哈希去重。
- 未确认的用户长期记忆拒绝。
- 软删除后不再检索记忆。
- 取消的 Mock 模型请求抛出 `AbortError`。

## 本地资料导入验证

已在纯本地模式导入 `rag` 主题的一份 PDF 资料：

```text
导入结果：indexed
主题：rag
文档：48f5f02f-590a-45bd-98ca-9599c4db3faf
分块：1252
```

SQLite 验证该文档状态为 `indexed`，并存在 1,252 个带页码的 Chunk。单文件上限经确认调整为 250 MB。

## Pi 约束部署验证

已部署 `AGENTS.md`、`.pi/extensions/zhixing-guard.ts`、`.pi/settings.json` 与安全启动器 `scripts/pi-safe.sh`。Pi 在项目信任模式且关闭工具的 smoke 中成功返回 `GUARD_READY`；安全启动器在禁用未知 Extension 的 smoke 中返回 `SAFE_LAUNCHER_READY`。仅允许 bash 的负向 smoke 请求网络命令时未产生网络调用，模型返回项目限制提示。`npm run verify` 已通过 lint、typecheck、10 个测试、integration、eval、mock smoke、敏感信息扫描和 diff whitespace 检查。完整规则和启动方式见 [Pi 项目约束部署](../pi-constraints.md)。

当前产品状态与任务台账见 [实际开发 Backlog](../implementation-backlog.md)。

## 后续状态

该快照中的 P0/P1 缺口均已收口；P2 增加本地 OCR、向量兼容存储、OS sandbox 与 loopback SSE。当时 SQLite schema migration 为 v2；当前代码已记录 1、2、3 三个迁移版本，见 [数据契约](../data-and-quality-spec.md)。
