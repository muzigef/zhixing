# 学习 Agent 0.3 升级验收

日期：2026-09-05。开发基线：`e072512`，根包 0.1.0、桌面 0.3.0。本轮按用户授权实现架构分析的必要开发；本记录覆盖本地开发验收，不宣称远端 Actions 或 Release 已完成。

## 已实现与失败复现

| 切片 | 改动与真实边界 | 验证依据 |
| --- | --- | --- |
| A 基础可靠性 | 修复长回答导致目标丢失、分块截断、取消阻断同内容重试、mock 被误拦截、数字主题路由 | upgrade-foundations、CLI E40、完整 verify |
| B 共享学习入口 | LearningApplication 贯通 CLI/桌面课程、进度、资料和来源；只显式连接工作区，不迁移用户聊天 | learning-application 与真实学习 UI；长段落引用精确定位、并发导入失败先复现再修复 |
| C 连续任务 | 排队/纠正/撤回/停止、重启后手动继续，目标/约束/摘要独立保存；共享模型/工具循环、严格完成协议和步骤 | desktop-tasks、agent-quality-eval、两套 UI；磁盘失败的未保存待办曾继续执行，已回滚并加回归 |
| D 实际产物 | 产物副本/hash/时间、完整性 Review、来源进日志；用户报告明确标为未复跑；macOS 本地 JS 测试结果绑定哈希 | evidence-application、CLI workflow、真实 Electron 与实际包运行 addition 测试，退出码 0 |
| E 质量/分发 | 自动协议验收 + 12 项人工质量用例；分 Provider P50/P95；Electron/SQLite 准备、平台构建/实际包 UI/draft release、主动版本查询 | desktop-diagnostics、eval:agent、实际 macOS 打包、DMG 验证；远端与其他平台未验收 |
| F 文档与产物 | 同步 README、架构/契约/配置/CLI/测试/开发、任务与 Backlog，新增升级指南 | 当前文档本地链接无缺失，工作流 YAML 校验通过，完整质量门通过 |

## 依赖与环境修复

- 根目录和 desktop 两套依赖均已安装。新增 YAML/桌面 PDF/SQLite 依赖时，原 npm registry 无法解析；通过单次官方 registry 命令安装，未更改全局配置。
- Electron 44 npm 安装后缺运行文件，项目内 installer 安装成功。现有 prepare-runtime 脚本自动完成安装、ABI 探测和必要重建。
- YAML 的 CommonJS 模块在 ESM bundle 内曾触发动态 require 错误，主进程 bundle 加入 createRequire 后实际 Electron 启动通过。
- macOS Node 在最小 sandbox 下需要读取根目录元数据和临时目录的规范路径；已按实际错误调整受限规则，仍拒绝外部文件内容、网络及非允许命令。
- 原 UI 失败点包括新控件标签不匹配、未等待目标对话框关闭；修正测试同步点后，两套开发和实际安装包 UI 全部通过。

## 最终本地命令与结果

环境：macOS Apple Silicon，Node 24.8.0，Electron 44.2.0。

| 命令 | 实际结果 |
| --- | --- |
| `npm run verify` | 退出 0；lint、根/桌面 typecheck、64 个文件 / 306 个 Vitest、9 个 integration、6 个旧 eval、mock smoke、敏感扫描和 diff 空白检查通过 |
| `npm run eval:agent` | 退出 0；4 个文件 / 15 个专项测试通过；它们是上述全量测试的子集 |
| `npm --prefix desktop run test:ui` | 退出 0；原有 UI 和新增学习任务 UI 通过 |
| `CSC_IDENTITY_AUTO_DISCOVERY=false npm --prefix desktop run dist:host` | 退出 0；构建 0.3.0 macOS arm64 `.app` / DMG / ZIP |
| 指定实际 `.app` 的 `ZHIXING_DESKTOP_EXECUTABLE` 后运行 `test:ui` | 退出 0；验证同一打包应用的原有及学习任务流程 |
| `hdiutil verify desktop/release/Zhixing-0.3.0-mac-arm64.dmg` | VALID |
| `npm --prefix desktop run checksums` | 当前版本 2 个安装器的 SHA-256 已生成 |
| 文档链接与 YAML 解析 | 无缺失的本地 Markdown 链接；verify / desktop-release 工作流语法有效 |

新增 UI 覆盖：课程状态、Markdown 与文字 PDF 原生导入、会话授权、来源打开、证据提交/Review、真实受限 JS 测试、排队/立即调整/停止/重启恢复、持续目标和主题隔离。截图在系统临时 `zhixing-desktop-preview` 中；已实际查看课程/证据面板及暂停任务界面。测试只用合成材料，临时数据在结束时清理。

## 安装产物

- `desktop/release/mac-arm64/知行.app`，版本 0.3.0，Info.plist 的最低 macOS 版本为 13.0。
- DMG：`Zhixing-0.3.0-mac-arm64.dmg`，185223885 字节；SHA-256 `372f105fa100add77d265d7a26956f2a0bc13001eef1a1aee785bd0cde96dabe`。
- ZIP：`Zhixing-0.3.0-mac-arm64.zip`，193770716 字节；SHA-256 `c043c3a3d9cbda8a3e8584f57a98ddeaa26444412300123254cd75dde2777a79`。
- 清单：`desktop/release/SHA256SUMS-darwin-arm64.txt`。构建目录受 Git 忽略，未上传；旧安装器保留。

## 未验证与产品边界

- 没有发送用户资料或发起真实模型请求，没有读取认证文件或修改真实密钥。Pi 配置识别、demo 输出、协议夹具通过不代表 Pi 登录成功或真实内容质量达标。
- 人工质量集尚未运行；本机诊断是历史样本元数据，不是已测得的 Pi/DeepSeek 性能基线，也不是两者的速度排名。
- Windows/Intel Mac 实机、系统新密钥保存、签名/公证、GitHub Actions 运行及正式发布，需要对应环境，未记为通过。
- 本地代码执行仅提供 macOS 的固定 JS 测试入口；其他平台显示不可用。Review 只确认产物完整性，不证明通用正确性或学习掌握程度。
- 不提供通用 Shell/任意文件编辑、多 Agent、MCP 市场、精确 token/成本、语义 embedding、逐句事实核实、完整数据备份或跨设备同步。未声称达到商业编程 Agent 的全部能力。
