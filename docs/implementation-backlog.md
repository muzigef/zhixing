# 实际开发 Backlog

> 当前状态：无已登记的 P0、P1、P2、P3 开发遗留项。

## 已完成基线

- P0：学习状态机、Reviewer、资料库/citation、记忆、运行审计、Provider 路由与 E01–E31 本地自动化验收。
- P1：完整 Topic Plan、课程/Skill 内容、带 citation 的 grounded answer、计划调整/复习与 session snapshot。
- P2：本地 OCR 和低置信度页、本地向量兼容存储与混合检索、无 Docker 的 macOS 受限执行、loopback Web/SSE 同步契约。

详见 [任务台账](../TASKS.md) 和各阶段 Evidence。真实 Provider smoke 仍为可选项；已配置 Provider 时默认可用，设置 `ZHIXING_ALLOW_LIVE_PROVIDER=0` 可禁止调用。

## 新需求入队标准

新项目项必须包含：用户可见目标、主题与隐私边界、失败/边界测试、验收命令和 Evidence 路径。不得以“基础实现”代替已验证闭环。
