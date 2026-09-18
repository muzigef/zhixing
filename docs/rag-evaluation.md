# 分层 RAG 开发评测

2026-09-18。入口为 `scripts/benchmark-rag.ts`，固定公开开发题和资料在 `src/rag-evaluation-cases.ts`。用途是区分检索缺口、生成误读与输出检查误拦；不是未见题或真实学习效果证明。

## 三个观察层

1. 检索：真实导入、当前主题检索及原文版本校验，按标注文档＋锚点计算 Recall@3，保存实际返回片段。
2. 固定证据生成：提供标注的必要原文，检查模型拿到正确资料后能否回答。评分标准和预期答案不进入生成请求。
3. 端到端生成：同一道题使用真实检索前三条，调用生产 `answerFromEvidence` 路径。检索失败、跨主题或哈希不符时不继续生成该组，固定证据组仍单独记录。

八题包括条件限定、无来源、旧/新版本、资料提示注入、不可直接合并的实验、多来源恢复、主题隔离和学习效果推断。语义检索更大开发基准另见 `scripts/benchmark-retrieval.ts`（30 题，检索层专用）。

## 使用

项目根目录执行；输出使用新文件名，已有报告不会覆盖。默认离线生成器只验证流程，不能用其回答计算真实模型优劣。

```bash
npx tsx scripts/benchmark-rag.ts --output=.build/rag-demo-new.json
npx tsx scripts/benchmark-rag.ts --provider=native-codex --live --embedding=embeddinggemma --case=RAG01,RAG04 --output=.build/rag-live-new.json
npx tsx scripts/review-agent-quality.ts --report=.build/rag-live-new.quality.json
npx tsx scripts/review-agent-quality.ts --report=.build/rag-live-new.quality.json --reviews=已填写的评分.json
```

真实生成只经已验收版本的官方 Codex 运行时，使用其自行管理的订阅登录。`--live` 必须显式选择，`ZHIXING_ALLOW_LIVE_PROVIDER=0` 仍禁止请求；没有自动切换付费 API。可选嵌入只调用本机已安装模型，评测不会自动下载；请求语义检索后发生回退会记为失败。原生入口不开放工具或本机文件给模型。

每轮最多八题、两种生成条件、16 次模型调用；每次最多 8,000 个可见字符、120 秒，整轮 600 秒。订阅 token 成本为返回后的实际观测，不是硬 token 额度保证。

报告与同名 `.quality.json` 持续保存：每个生成阶段和请求计数在派发前持久化；保存失败不继续发模型请求。进程被终止留下 `running` 表示结果未确认，不自动重放。失败/取消保留安全状态，不保存任意异常日志。报告保存资料、来源哈希、固定题标注、实际用量、原始回答、规则检查和用户可见结果，帮助识别“原模型答错”与“规则误拦”。

## 评分与比较

`.quality.json` 可交给现有逐项评分工具。`fixed:native-codex` 和 `end_to_end:native-codex` 是两个生成条件，实际模型相同。评分按精确报告哈希绑定，默认待复核；完成率、引用有效或未触发规则都不自动算正确。独立性由评分人声明，开发侧复核必须标注 `development_assistant`、`independent=false`。

题集身份去除每次导入新分配的 UUID，同时保留来源原文、锚点与内容哈希；全文语料哈希、代码来源、模型、检索配置和预算另记录在主报告 `conditions`。比较应连同主报告核对所有条件，不能只比较完成数，也不能把两个阶段当作独立问题样本。

新数字的可解释检查仅支持同一指标、同一单位的两个端点差值/百分比；零分母、单位混合、错误方向/分位数或不明条件继续拒绝。圆整需明确“约”。一般数学证明、隐含条件及任意语义改写仍需独立评阅。

## 当次验收

[开发与真实回执](evidence/interview-improvements-20260918.md)记录实际版本、失败、修复和最终命令；不把 2026-09-18 的少量连接/内容对照外推为长期平均质量。真实教学效果应使用学习结果研究模块。

2026-09-18 I15 更新：新生成的 quality sidecar 已携带主报告的运行条件及全题集 rubric 哈希；旧侧文件保持原状，仍须联同对应主报告解释。详见 [评测设计](evaluation-design.md)。
