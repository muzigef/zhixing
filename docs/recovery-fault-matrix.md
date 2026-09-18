# 恢复故障注入与边界

2026-09-18。测试只使用隔离合成工作区、数据库和本地服务，没有修改用户资料。

| 注入点 | 必须保持的结果 | 证据 |
| --- | --- | --- |
| 已执行模型请求，结算会话文件 rename 失败 | 当前预算实例禁止新请求；新进程式重载仍保留未知预留，不能再次花掉额度 | recovery-fault-matrix / team-budget |
| checkpoint 更新后执行事件 INSERT 失败 | SQLite 事务回滚两者，未知外部写入仍处于 executing | recovery-fault-matrix |
| 并发请求等待/派发后取消 | 未派发者不调用，已占用且缺回执的预算不清零 | team-budget-accounting / team-budget |
| 团队成员已保存，进程 SIGKILL | 已完成成员不重跑，未知成员和预算保留 | team-crash-recovery（真实子进程） |
| 外部写后断线、错误查询/身份/请求错配 | 不自动重放，保持未知；受控只读核验才能推进 | task-continuity（真实 MCP 子进程） |
| 数据库恢复目标有 WAL/SHM/journal | 拒绝，不删除可能含未提交内容的文件 | recovery-fault-matrix |
| 恢复临时副本损坏、被换为另一有效 DB、最终 rename 失败 | 原目标不变，清理自己的临时文件 | recovery-fault-matrix |
| 未来数据库、链接备份 | 校验前拒绝，原目标不变 | recovery-fault-matrix |
| 只读数据库检查 | 在私有副本运行 SQLite，避免生成 WAL/SHM 修改备份目录或读取未在清单内的日志 | recovery-fault-matrix |
| 备份写 manifest 时取消 | 不返回成功，清理本次未完成备份 | recovery-fault-matrix |
| 完整恢复已发布部分会话后取消 | 原工作区/备份保留，不返回成功；新副本保留 RESTORE-INCOMPLETE，已导入会话撤销执行授权 | recovery-fault-matrix |
| 新账目被旧格式覆盖 | 带逐请求预算或摘要 recipe 的会话写 v14，保留升级前副本，拒绝降级覆盖 | recovery-fault-matrix / AgentSessionStore |

数据库恢复先检查与绑定备份 SHA256，在目标旁建立唯一临时文件，核对实际临时内容、schema 与 quick_check，再复核目标签名和日志状态，最后原子替换。CLI 在关闭数据库前取得检查哈希，恢复时再次对齐。调用方必须关闭所有目标数据库使用者；日志存在检查不证明任意外部进程没有打开数据库，也不提供跨进程文件锁。

完整工作区恢复仍是非破坏性的新工作区与新会话；跨 SQLite/JSON/文件系统没有全局事务。已发布的部分结果不能被取消自动撤销，因此明确保留并标记，不删除用户可能正在查看的会话。原子 rename、进程崩溃与取消测试不等于突然断电后的硬件持久性认证。
