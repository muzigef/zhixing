# P2 自动执行 Tasklist

> 历史计划或版本记录：下文保留当时的设计、范围及验证结果，不是当前功能清单或新的开发指令。现行实现、已完成的后续改动与待验收项见 [当前状态](current-status.md) 和 [文档导航](README.md)。

> 历史阶段清单，保留完成标记。当前进展已包含 P6–P10，见 [任务台账](../TASKS.md)；实际功能边界见 [功能与验收](features-and-acceptance.md)。

- [x] P2-01：OCR 接口、低置信度页状态与本地 OCR adapter。
- [x] P2-02：本地 Embedding、SQLite 向量兼容表、混合检索与重排序（不使用 sqlite-vec 扩展）。
- [x] P2-03：OS sandbox 设计、受限执行边界与安全验证（Docker/Colima 已卸载，非运行依赖）。
- [x] P2-04：本地 Web/SSE 服务与主题隔离的多端同步契约。
- [x] P2-05：P2 integration/eval、Evidence、README 与任务台账同步。
