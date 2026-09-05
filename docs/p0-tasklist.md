# P0 自动执行 Tasklist

> 历史阶段清单，保留完成标记。当前进展已包含 P6–P10，见 [任务台账](../TASKS.md)；实际功能边界见 [功能与验收](features-and-acceptance.md)。

> 本清单从 `TASKS.md` 的未收口项拆分而来。每项均遵循：失败/边界测试 → 最小实现 → 定向验证 → `npm run verify` → 更新 Evidence。除产品命令本身的确认语义外，不需要人工逐项授权。

## 1. CLI 工作流与审计

- [x] P0-01：为 E01–E06 增加 headless CLI 端到端测试：Day 输出四栏目、前置拒绝、Review 的 repair/advance、最小继续、源码 gate。
- [x] P0-02：为 E07/E10/E12 增加 CLI 端到端审计断言：取消、Run 事件顺序、工具/model metadata、最大轮次与重复工具停止原因。

## 2. 主题隔离与 Provider

- [x] P0-03：为 E11、E13–E16 增加 Provider fallback、主题隔离、跨主题写拒绝、重启后 session 恢复和全部进度的端到端 Eval。
- [x] P0-04：完成 E17–E20 的模型管理 CLI：安全状态/列表、角色路由健康检查、不可用 Provider fallback、Codex adapter 的受控 Runtime 路径。

## 3. 资料库、引用与删除恢复

- [x] P0-05：完成 E21–E29：主题/文件/页数配额，导入回滚与失败状态可追溯，citation 定位完整性评估，以及 CLI 端到端覆盖。
- [x] P0-06：完成 E30：资料和记忆删除影响预览、受确认的数据库恢复 CLI、恢复前备份预览；不实际覆盖现有数据库。
- [x] P0-07：完成历史 E31：纯本地零外发与资料外发确认门的 CLI 覆盖。当前 Provider 默认策略已变更，见 `SECURITY.md`。

## 4. 发布验收

- [x] P0-08：将 E01–E31 汇总为可追溯 Eval 报告，更新 `TASKS.md`、Evidence、README 已知限制；全量 `npm run verify` 通过。
