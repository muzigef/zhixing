# 项目级实践

桌面「课程与资料 → 实践项目」可以创建独立项目，或由用户用系统对话框选择一个目录，复制其中允许的文本文件。项目按主题隔离，选择项目后，授权当前会话使用学习上下文，Pi Codex / DeepSeek 才能发现项目工具。取消选择立即撤销后续工具访问。

## 使用流程

1. 创建项目或导入副本。新项目内置 `src/implementation.mjs` 和 `test/implementation.test.mjs`。
2. 查看文件、编辑内容并预览差异，再保存；也可以让 Agent 修改，逐次审批卡会展示实际差异。CLI 审批也显示差异。
3. 执行项目测试。只有真实测试通过且文件内容仍匹配这次测试，才能保存 Git 检查点。失败输出在面板中保留；修正后重新测试。
4. 查看检查点历史、当前差异和测试状态。文件变化立即使旧测试失效。测试通过记录与学习者独立掌握分别保存。

模型使用 `project_status`、`project_read`、`project_edit`、`project_test`、`project_checkpoint`。读取文件和列表支持分页；修改包含完整新文本和刚读到的文件哈希，拒绝覆盖期间发生的修改。项目计划使用 `project_file_saved`、`project_tests_passed`、`project_checkpoint_saved` 完成条件，并绑定项目 ID；结束时按真实文件和测试重新核验。

## 文件、执行和 Git 边界

- 每主题最多 20 个项目；每项目最多 40 个文本文件、总计 256 KB、单文件 24 KB、四层目录。导入扫描最多 2,000 项，过滤隐藏项、依赖目录、构建目录和敏感文件名；不复制源目录的 `.git`，不修改导入源。
- 拒绝越界路径、符号链接、硬链接、非 UTF-8 和含 NUL 的文件。受控路径校验不能替代针对其他本机进程同时替换路径的 OS 隔离。
- 测试仅执行 `.test.mjs`，使用内附 Node 和现有本地沙箱，最长 10 秒；不执行任意 Shell、npm 安装或网络请求。当前实际隔离实现仅支持 macOS；其他平台明确返回不可用，不将未运行的测试记为通过。
- 每个项目有独立 `practice/<项目 ID>` 分支和受控裸 Git 仓库，文件与 Git 元数据分开保存；需要本机 Git 可用。禁用全局配置、钩子及外部对象库引用。检查点仅写本地仓库，没有自动推送、任意用户仓库编辑或合并功能。
- 文件写入使用哈希比较和原子替换；测试和检查点绑定整个项目哈希。项目操作持有进程租约，恢复会核对实际结果；不能用模型声明把步骤标为完成。

完整备份包含项目文件及受检 Git 历史。恢复到新工作区后保留内容与历史，但清空项目选择、执行租约及外部工具授权，需要用户重新连接。项目存放在工作区 `zhixing/projects/`，不随源码提交。

验证命令与本轮结果见 [P1/P2 验收记录](evidence/agent-p1-p2-20260907.md)。真实模型项目脚本只使用临时合成数据：

```bash
node --import tsx scripts/evaluate-practice-project.ts --live --provider=pi-codex --output=docs/evidence/project-live-pi-new.json
node --import tsx scripts/evaluate-practice-project.ts --live --provider=deepseek-api --output=docs/evidence/project-live-deepseek-new.json
```

输出路径必须不存在。报告保存原文、实际文件状态和工具记录；一次成功只验证该场景，不代表开放项目任务成功率。
