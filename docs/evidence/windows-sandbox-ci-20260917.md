# Windows 沙箱 CI 故障修复：2026-09-17

实现基线：`795c7fe6268b3e03cc1dd789e26dda14db6e84f7`。本轮修复 `24cc3a5` 的 Windows 原生 CI 失败；机器回执、源文件及测试报告哈希见[验收 JSON](windows-sandbox-ci-20260917.json)。安装包与真实模型验收不在本轮范围。

## 结论与原因

1. **诊断信息丢失。** 原生 helper 返回错误码，但 TypeScript 协议没有保留，导致首次失败只有空的 `unavailable`。现在保留受限的阶段名及 Win32 / HRESULT / NTSTATUS，不输出任意异常文本、命令参数或环境值。首次日志的底层错误无法事后恢复，不把后续复现写成首次错误码已知。
2. **目录配额扫描竞态。** 新增真实压力测试复现了目录删除期间的 `0x80070003`；仅处理不存在后，又复现了待删除对象映射出的 `0x80070005`。最终改成按目录句柄枚举，属性和大小来自同一内核记录，子目录以父句柄相对打开，并检查 reparse 属性。不存在、待删除、类型变化与真实访问拒绝分别处理；没有整体忽略权限错误，也不通过重建路径跟随被替换的 junction。
3. **Python 预算与准备成本。** 原有固定两秒探测可能在任务预算未用完时误判环境缺失；私有运行库准备没有完整纳入截止时间，取消也要等完整复制后才生效。新实现将探测、准备、执行接入同一任务期限，区分缺失、超时和用户取消，并等待清理。成功工作不会因清理跨过期限而被追溯改成超时。
4. **逐文件复制成本仍不稳定。** 排除字节码缓存、限制并发后，完整标准库的文件创建与 ACL 处理仍能耗尽十秒。最终采用 CPython 支持的 ZIP 导入：受控宿主程序只归档已选解释器的标准库，扩展模块仍是受限私有副本；`._pth` 固定为 `stdlib.zip` 与 `DLLs`。不复制 site-packages、缓存、符号链接或 Windows junction，不修改安装目录 ACL。学习者代码只在 AppContainer 内执行。

## 验证结果

- 本地 `CI=1 npm run verify`：**161 个文件 / 846 项测试通过**，包括 lint、两端类型检查、integration、eval、mock smoke、敏感扫描和 diff 检查。integration/eval 属于全量测试，不能重复相加。
- 本地 `npm --prefix desktop run test:ui`：**七组通过**；Provider 与加密采用隔离夹具，实际 Node/Python/Git 路径继续执行，不表示真实模型质量或账号验证。
- [最终四平台原生矩阵](https://github.com/muzigef/zhixing/actions/runs/35208329601)：Mac ARM **36/36**、Mac Intel **36/36**、Linux **37/37**、Windows **40/40**，均无失败或 pending。数字包括共同策略/协议检查，不是四组互不重复的测试。
- 同一代码提交的 [GitHub 质量门禁](https://github.com/muzigef/zhixing/actions/runs/35208329594)通过：两套生产依赖审计、完整 `verify` 与七组桌面 UI。
- Windows Python 完整探针本次 **2,251 ms**；标准库归档从第 160 ms 到第 816 ms，DLL 副本准备于第 1,008 ms 结束。任务预算仍为 **10,000 ms**。这是一次干净 runner 的观察，不是长期性能承诺。
- 新增回归覆盖：3,000 次目录创建/删除循环；准备期取消与私有目录清理；探测截止与取消；执行完成和清理竞态；有界复制、预算、链接排除及失败后等待全部 I/O；实际 Python ZIP 校验与模块导入；错误回执脱敏。原有越界读写、联网、子进程、输出、CPU、内存、目录配额与运行中取消断言保留。

## 保留的失败证据

| 运行 | 结果与解释 |
| --- | --- |
| [初始 main](https://github.com/muzigef/zhixing/actions/runs/35203552402) | Windows 20/22；节点探针和 Python 均不可用，错误信息不完整 |
| [新增压力测试](https://github.com/muzigef/zhixing/actions/runs/35205191766) | 复现目录不存在竞态；Python 另出现长等待 |
| [准备期限](https://github.com/muzigef/zhixing/actions/runs/35206187821) | 准备超时能正确结束并清理，但标准库复制仍过慢 |
| [逐文件并发复制](https://github.com/muzigef/zhixing/actions/runs/35206732382) | 复现待删除访问拒绝；Python 完成后清理跨期限误报超时 |
| [句柄扫描](https://github.com/muzigef/zhixing/actions/runs/35207317136) | 目录压力与其他 Windows 边界通过，Python 逐文件准备仍超时 |

这些失败没有通过跳过测试、放宽隔离、增加原生测试预算或仅重跑来消除。固定宿主的标准库归档是新增的受信任适配器，通过 `python-runtime` 网关登记并受 AST 入口审计；它本身不是 OS 沙箱。原有平台能力限制继续适用，见[执行边界](../execution-sandbox.md)。

实现依据：[Windows 句柄查询](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getfileinformationbyhandleex)、[相对打开目录](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntopenfile)、[Python ZIP 导入](https://docs.python.org/3/library/zipimport.html)、[Windows Python 路径配置](https://docs.python.org/3/using/windows.html#finding-modules)。
