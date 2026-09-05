# 验证证据索引

截至 2026-09-05，代码基线为 `6b87f51`。Evidence 是各次实际执行的快照：保留原始测试数量、失败和未验证项，不将历史结果追改成今天的结果。现行功能见 [功能与验收](../features-and-acceptance.md)，配置见 [配置](../CONFIGURATION.md)。

## 最近交付

| 记录 | 范围与适用性 |
| --- | --- |
| [文档同步](documentation-sync.md) | 本轮按代码核对全部项目文档、修正事实与链接、记录现存缺口 |
| [P10 桌面应用](desktop-app.md) | macOS arm64 本地 `.app`/DMG/ZIP、281 个测试、开发与打包应用 UI、DeepSeek 最小真实请求；Pi 认证与 Windows 未通过真实验收 |
| [P9 Pi Codex](pi-codex-integration.md) | 配置继承、协议/取消/身份校验；当时 267 个测试，真实认证失败 |
| [P8 连续对话](fluent-conversation-audit.md) | 持久聊天、输入队列、即时停止/调整、多行输入；当时 249 个测试 |
| [P7 交互质量](interaction-quality-audit.md) | 自然路由、风格、练习、输出和引用；当时 221 个测试 |
| [P6 运行时审查](agent-runtime-audit.md) | DeepSeek 工具续写、取消/预算/路径和状态加固；当时 167 个测试 |

P6–P9 后续合入 `c7f8891`，P10 合入 `6b87f51`。旧记录中的“未提交/未推送”描述的是写下该记录的时点，不是当前仓库状态。

## 早期阶段

| 记录 | 内容 |
| --- | --- |
| [基础](foundation.md) | 最早 CLI、主题、资料索引、Pi 守卫验证 |
| [B01–B03](b01-b03.md) | 资料引用、运行审计、Reviewer |
| [B04–B06](b04-b06.md) | 记忆、删除/备份、Codex CLI 初版 |
| [B07](b07.md) | Skill Catalog 与主题资源 |
| [B08](b08.md) | 版本化计划与复习 |
| [E01–E31](e01-e31-coverage.md) | 历史 P0 验收映射，分布在多个测试文件，不是 eval 脚本含 31 个用例 |
| [P1](p1-acceptance.md) | 课程、资料问答、计划与 session |
| [P2](p2-acceptance.md) | 本地 OCR/向量、受限执行、本机 HTTP/SSE |
| [P3](p3-personal-learning.md) | 画像、计划、Skill 草案和建议 |
| [P4](p4-learning-orchestration.md) | 主题创建、定制课程、提醒计划 |
| [风险收口](risk-remediation.md) | SSE、sandbox、SQLite 恢复、OCR 与 CI 初版 |
| [早期 Provider smoke 状态](provider-live-smoke.md) | 当次跳过真实请求的历史记录 |
| [DeepSeek 最小 smoke](deepseek-smoke.md) | 独立最小真实请求，不代表持续可用性或内容质量评测 |

## 如何解释结果

自动化合成响应验证协议、状态和边界，不证明真实模型教学质量。模型配置可读取不证明认证成功。单次首字耗时不是长期性能基准。系统加密抽象通过单测不等于各 OS 的真实新密钥保存已验收。签名、平台构建和安装包发布分别需要自己的证据。

完整本地检查与独立桌面 UI/安装包测试步骤见 [测试指南](../TESTING.md)。目前 CI 安装步骤遗漏桌面依赖，详见 [Backlog](../implementation-backlog.md)。
