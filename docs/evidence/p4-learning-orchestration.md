# P4：通用主题与学习编排

- `创建主题 <topicId> <标题>` 在本地注册表中持久化新主题，并初始化主题计划、Skill 与 inbox 目录；主题 ID 允许安全的数字开头形式，例如 `3dgs`。
- `生成定制课程` 根据已保存画像生成 Day 课程草案；`启用定制课程 <version> --确认` 才替换当前主题计划，并备份旧计划。
- `主题概览` 汇总当前主题进度、资料、画像和提醒计划；`下一步` 返回当前学习状态的最小下一动作。
- `提醒设置 HH:MM` 只保存用户主动设置的本地提醒计划，不启动后台进程或系统通知。

验证：`tests/topic-store.test.ts`、`tests/custom-course-store.test.ts`、`tests/reminder-store.test.ts`，以及全量 `npm run verify`。
