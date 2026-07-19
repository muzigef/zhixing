# P1 验收记录

## 已验证能力

- Topic Plan 逐 Day 解析：标题、时长、证据要求与可选项进入 Day 输出和 Reviewer 门槛。
- 四个首批主题均具备课程 Plan、实验卡、失败案例与证据模板。
- grounded answer 按需注入当前主题 Skill 摘要，并拒绝缺少可定位 citation 的模型输出。
- 计划调整保留版本；复习计划按低分优先，并给出 1/3 天间隔。
- Session snapshot 按主题保存、恢复最新记录并裁剪旧历史。

## 验证命令

```text
npm run verify
-> lint pass
-> typecheck pass
-> 26 test files / 79 tests pass
-> integration pass
-> eval pass
-> mock smoke pass
```

## 限制（历史快照）

- 真实 Provider smoke 仍为可选项。记录时采用默认纯本地；当前 Provider 策略见 `SECURITY.md`。
