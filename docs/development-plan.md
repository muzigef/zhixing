# 知行全量开发计划

> 状态：P0、P1、P2 已完成；P3-01（模型无关的个性化学习闭环）已完成；文档同步状态：**完整同步**。本文反映当前实现，不以早期排期替代实际台账，并明确区分边界测试与环境级验收。
> 验收入口：[任务台账](../TASKS.md)、[P0](p0-tasklist.md)、[P1](p1-tasklist.md)、[P2](p2-tasklist.md) 与 `docs/evidence/`。

## 已完成能力

| 阶段 | 已交付内容 | 验证 |
| --- | --- | --- |
| P0：MVP 闭环 | 主题状态机、review、资料导入/FTS/citation、记忆、审计、Provider 路由、备份恢复、安全与 E01–E31 覆盖 | `npm run verify`、`e01-e31-coverage.md` |
| P1：学习体验 | Topic Plan、课程和 Skill、grounded answer、计划调整与复习、session snapshot | `p1-acceptance.md` |
| P2：本地扩展 | Tesseract OCR、低置信度状态、SQLite 向量兼容表、混合检索、macOS 受限执行、loopback Web/SSE 契约 | `p2-acceptance.md` |
| P3：个性化学习 | 每主题学习画像、待确认计划、资料概览、Skill 草案与显式启用、模型无关建议、实际 Provider 审计 | `p3-personal-learning.md` |

## 当前技术边界

- 默认纯本地；真实 Provider 仅在用户设置 `ZHIXING_ALLOW_LIVE_PROVIDER=1` 且命令显式允许外发后调用。
- OCR 仅使用本机 `tesseract` 与 `pdftoppm`。不可用或失败时保留 `ocr_required`，不伪造文本。
- 向量层使用可替换的本地 `HashEmbeddingModel` 和 `chunk_embeddings` SQLite 兼容表；不是云端 embedding，也不依赖 sqlite-vec 二进制扩展。
- 受限执行使用 macOS `sandbox-exec`、命令 allowlist、临时目录和超时；系统没有该工具时安全拒绝。Docker/Colima 不是依赖。
- 同步服务仅绑定 `127.0.0.1`，提供单主题 progress JSON/SSE；不包含云端账户、远程同步或冲突合并。

## 后续工作原则

P0–P2 与 P3-01 没有已登记的未完成项。任何新需求应创建新的任务切片，并先定义安全边界、测试和 Evidence；不得把可选真实 Provider smoke 当作本地发布阻塞项。
