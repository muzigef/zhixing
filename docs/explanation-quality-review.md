# 解释质量的独立维度评分

2026-09-18。适用于回答、RAG 分层结果及团队阶段材料。字段答案、JSON 格式、回答长度与解释质量分别验收。

`src/explanation-rubric.ts` 定义冻结的 `explanation-v1`：正确性检查事实/推导/条件；完整性逐项检查本阶段任务、必要步骤、边界和不确定性；清晰度针对指定读者检查概念说明、衔接及符号含义。每项 0–4 分：0 缺失或不可用，1 严重问题，2 部分成立但有实质不足，3 满足主要要求，4 准确充分且可核对。三个维度分别汇总，不靠平均分抵消错误。

新版 review 文件使用 `version: 2`、`rubricVersion: "explanation-v1"`。每条 score 保留 provider/id/repetition、逐项 criteria、rationale、failures，另须填写全部三个 dimensions；每个维度含 score、rationale 和 1–4 个 quotes。摘录必须来自实际回答或其 JSON explanation；不接受从标准答案捏造的摘录。报告哈希不匹配、重复评分、缺失维度、非法范围会拒绝。摘录匹配只能证明引用来源，不能替代人工理解或证明评分者真实独立。

只有逐项标准全通过且三项均至少 3 分才通过；任一项 0/1 分为失败，其他为部分满足。旧版 review 仍可读取，但解释维度保持“未评分”，不会根据长度补分。无文本/未完成的输出在交付失败中单列，不通过伪造摘录获得解释分。

先从当前版本 7 团队报告导出：

```bash
node --import tsx scripts/export-team-quality.ts --report=team.json --output=new-final-quality.json --stage=final
node --import tsx scripts/export-team-quality.ts --report=team.json --output=new-member-quality.json --stage=member-1
node --import tsx scripts/export-team-quality.ts --report=team.json --output=new-review-quality.json --stage=review
node --import tsx scripts/review-agent-quality.ts --report=new-final-quality.json --reviews=review.json --output=new-summary.json
```

还支持 `member-2`、`followup`。导出固定题集、实际阶段文本、阶段目标和评价要求；缺失组保留在计划分母，未执行的阶段不伪装为完成。成员按分配任务评分，审查阶段附带其成员材料；生成评阅包不意味着完成评分。导出绑定完整原报告哈希；有包哈希时记录在 codeHash，没有则为 unknown，不把结果文件哈希冒充实现版本。

每份评阅文件保留评分者声明（human / development_assistant）和 independent。开发助手不能声明独立人工评分。真实质量结论仍需要未参与实现的评阅者按同一冻结标准审阅；真实教学效果另需学习者的迁移、保持测验和研究协议。
