# 核心架构对比文档核对记录

日期：2026-09-08。任务：梳理当前知行核心设计，与 Codex、Claude Code 官方公开设计对比，说明原因、适用条件和优化建议，保存本地文档。

## 产物和范围

- [核心架构对比](../agent-architecture-comparison-20260908.md)：28 个模块组、核心数据模型、架构图、替代方案与 N01–N10 建议。
- README 文档索引增加入口。
- 本轮仅新增/修改文档；已有 0.7 实现及测试改动保持原状，没有提交、推送或安装应用。

源码基线：`32decd4fdb21f9a473d033fc71ef2045a5912e20` 加当前未提交改造。受控源码标识为 `ec289e9aacd254316322629ee1176a96dbbb3d6df797446d89dc07b090c3c511`，337 文件，Node v24.8.0，darwin-arm64。本文 Markdown 不属于代码 hash 的纳入范围。

## 实际核对

| 项目 | 结果 |
| --- | --- |
| 源码调用链、数据契约与代表测试 | 已读取并核对；文档逐项链接到对应源码 |
| 官方资料 | 打开 OpenAI 与 Claude Code 官方页面；正文链接对应具体主张，未推断闭源内部实现 |
| 源码标识计算 | `sourceProvenance(process.cwd())`，退出 0；codeHash 与 0.7 交付记录一致 |
| 摘要覆盖探针 | 下述合成探针实际运行退出 0；M19–M42 输入，through=M42，原文 50 条保留 |
| 本地链接与模块结构检查 | 最终退出 0：153 个本地链接有效、M01–M28 顺序完整、22 个官方引用定义匹配，各模块四项评审字段齐全；敏感模式、尾随空白与代码围栏检查通过 |
| `npm run verify` | 退出 0；114 文件 / 567 测试，integration 9，eval 6，mock smoke、lint、两套类型检查、敏感扫描、diff 空白检查均通过；日志 `/tmp/zhixing-architecture-comparison-verify.log` |

两套项目依赖已在同一源码快照的 0.7 交付任务中安装，本次没有改变依赖。首次加强文档结构检查发现 M11/M17 缺少显式的“理念与原因”字段，已补充；属于文档结构问题，不是产品测试失败。随后仅补充文档说明和验证结果，不改产品代码。

最终另行执行 `git diff --check`，退出 0。全量产品测试无需因结果回填重复运行；新增文档的路径、引用定义、结构和敏感模式已在回填阶段单独核对。

## 摘要覆盖探针

在仓库根目录执行如下只使用内存和合成模型的命令。不访问用户存储，不发起模型网络请求。

```bash
node --import tsx --input-type=module <<'NODE'
import { AgentService } from './src/agent-service.ts';
import { randomUUID } from 'node:crypto';
let sampled;
const client = {
  async *stream(prompt) {
    sampled = JSON.parse(prompt.slice(prompt.indexOf('{')));
    yield { type: 'text_delta', text: '合成摘要，仅用于静态策略核对。' };
    yield { type: 'done' };
  }
};
const session = {
  messages: Array.from({ length: 50 }, (_, i) => ({
    id: randomUUID(), role: i % 2 ? 'assistant' : 'user',
    status: 'completed', text: `M${i + 1}`
  })),
  context: { goal: '', notes: '' }
};
await new AgentService(undefined, () => client)
  .compact(session, client, 'mock', new AbortController().signal);
console.log({
  first: sampled.transcript[0].text,
  last: sampled.transcript.at(-1).text,
  count: sampled.transcript.length,
  through: session.messages.find(m => m.id === session.context.summaryThroughId)?.text,
  preserved: session.messages.length
});
NODE
```

结果：`first=M19, last=M42, count=24, through=M42, preserved=50`。这里利用 TypeScript `private` 方法编译后的可调用形式进行一次性诊断，不是推荐新的产品公共 API。它证明当前摘要输入和覆盖标记的差别；本轮未修复该边界，也未将该探针作为新的回归测试提交。

## 未验证与限制

- 未重新运行真实 Pi/DeepSeek 请求、UI、安装包构建或依赖审计；正文单独引用前轮结果。
- 未读取真实学习记录，未产生教学效果或商业产品优劣的实测结论。
- 源码评审和当前自动化测试不能证明无遗漏缺陷。N01 为合成复现，其余建议注明设计限制或需求触发条件。
