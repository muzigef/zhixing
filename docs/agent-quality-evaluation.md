# 回答质量评测与评分

本流程区分程序正确性、真实模型回答质量、独立人工评分和学习者效果。`npm run verify` 不需要真实模型；报告中“完成”只表示请求完成，不能当作质量通过。

## 留出题与运行条件

`agent-quality-cases.json` 是历史回归题。`agent-quality-heldout.json` 是 2026-09-07 冻结的新合成题：格式、求导、引用不足、续写、避免重复确认和实际资料工具。第一次运行后如针对这些题调提示，需将其视为回归题并另建留出集，不能继续称为未见题。

运行前构建桌面 worker，然后通过当前已配置的产品接口使用 Pi Codex 或 DeepSeek：

```bash
npm --prefix desktop run build
npm run eval:quality -- --heldout --reasoning=auto
npm run eval:quality -- --live --heldout --case=H01,H02,H03,H04 --reasoning=auto --output=docs/evidence/new-run.json
node --import tsx scripts/review-agent-quality.ts --report=docs/evidence/new-run.json --output=docs/evidence/new-summary.json
```

不加 `--live` 使用 demo；`--provider=pi-codex` 或 `--provider=deepseek-api` 可限定真实 Provider。默认每题两次独立会话，可用 `--repetitions=1` 做有界连通检查；最多两个 Provider、十二题；使用临时合成资料，结束清理临时工作区。联网总开关为 0 时拒绝真实运行。

报告默认文件名带时间戳，明确输出路径已存在时拒绝覆盖。每次完成原子保存进度；已知的重复调用停止或空回答属于当前题失败，保留记录并继续下一题。其他无内容失败仍保守停止该 Provider 的剩余计划，标为未尝试，不复制耗时或用量；未知错误不推断成连接故障，执行器异常记为 evaluation_failure。报告保存题目、种子历史、标准、答案、实际模型和思考档位、首字/总耗时、调用轮数、工具次数、用量与 worker 计时（仅 Provider 提供时）。数据集 SHA-256 绑定所选题目；构建来源覆盖核心、renderer、worker、两套依赖锁、脚本、Skill、主题和评测数据，逐文件哈希随报告保存；生成报告和用户数据不参与哈希。代码哈希不替代发布构建签名。

## 导入评分

先读取统计输出的 `reportHash`。哈希按对象键排序后计算，数组顺序和所有原始值均参与，避免 JSON 属性顺序改变导致误判。评分逐条绑定 Provider、题号和重复序号，`criteria` 顺序必须对应报告中的标准。

```json
{
  "version": 1,
  "reportHash": "替换为统计输出中的64位哈希",
  "reviewer": { "name": "填写实际评分者", "kind": "human", "independent": true },
  "scores": [{
    "provider": "pi-codex", "id": "H01", "repetition": 1,
    "criteria": ["pass", "partial", "pass"],
    "rationale": "填写基于原回答的可核验理由",
    "failures": ["accuracy"]
  }]
}
```

`kind` 也支持 `development_assistant`，此时 `independent` 必须为 false。独立人工复核是评分者的声明，程序不能认证身份；不得将开发助手自评标成人工独立评分。失败类别为 accuracy、grounding、format、repetition、unnecessary_question、execution、other。任何标准 fail 则总体 fail，否则有 partial 则总体 partial，其余为 pass。

```bash
node --import tsx scripts/review-agent-quality.ts --report=docs/evidence/new-run.json --reviews=docs/evidence/new-scores.json --output=docs/evidence/new-reviewed.json
```

过期哈希、重复条目、不存在/未尝试结果、标准数量不匹配均拒绝。未评分留空，不需要凑齐所有题才能保留部分复核。单份评分文件对应一位评分者；多位评分者分别输出统计，不擅自合并成一致意见。

## 统计口径

统计明确计划数、已记录数、实际尝试、完成、待评分、评分数及通过数。通过率的分母是已评分结果；尚未评分时为 null。独立人工评分数量单列。按实际 Provider/模型/思考档位分组，只有完成回答进入延迟样本，未知值不补零，采用最近秩 P50/P95，始终显示样本数。

不同数据集、代码、模型和设置不能直接混为一组。小样本耗时受网络和服务负载影响；按需发现可能节省 schema，也可能增加一次往返。只有对照数据支持时才能声称更快。真实学习效果仍需真实学习者独立作答与延迟复习，见学习效果验证功能。
