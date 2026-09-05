# P10 桌面版验收（2026-09-05）

> 适用范围：P10 在 2026-09-05 的本机验收快照，对应代码提交 `6b87f51`。安装路径、模型状态、测试数量和耗时仅说明当次结果；当前使用说明见 [桌面 README](../../desktop/README.md)，本轮文档核对见 [文档同步](documentation-sync.md)。

## 结果

已完成 macOS Apple Silicon 桌面应用、DMG 和 ZIP。采用会话侧栏、连续对话、固定输入框的布局；包含停止/继续/重试、历史与草稿恢复、搜索、重命名、复制、Markdown 导出、数学渲染、主题与设置。

支持 Pi Codex 与 DeepSeek API 切换。Codex 失败后的切换重试保持原会话；每个回答记录实际 Provider。DeepSeek 已用本机现有钥匙串配置完成真实短请求，无需重新填写 API Key。

## 真实验证

| 检查 | 结果 |
| --- | --- |
| 仓库质量门 | `npm run verify` 通过，58 个测试文件、281 个测试；包含 lint、根目录/桌面类型检查、integration、eval、mock smoke、敏感扫描和 diff 检查 |
| Electron 开发窗口 | 完整 UI 测试通过 |
| 打包后的 `.app` | 使用 `ZHIXING_DESKTOP_EXECUTABLE` 指向真实应用，再次完整 UI 测试通过 |
| 内置 Pi | 在清空 PATH 的子进程中成功执行内附 Pi `--version`，得到 `0.80.7`，不需要系统 Node/Pi 可执行文件 |
| 模型切换 | 实测 UI 的 Codex 失败 → DeepSeek 重试，以及重启后 API / 模型选择持久化；此测试禁用真实外发 |
| DeepSeek 真实 API | 由应用 Runtime 取用已有钥匙串配置，`deepseek-v4-flash`，问题「2+2 等于几？只回复一个数字。」；返回 `4`，完成状态 `completed` |
| 本次连接耗时 | 首字 2317 ms，总耗时 2383 ms。单次短请求，不代表复杂任务或长期速度基准 |
| DMG 完整性 | `hdiutil verify` 返回 checksum VALID |
| 视觉检查 | 查看首屏、对话/代码/数学、暗色设置、窄窗口与 DeepSeek 配置截图；修正了设置按钮的可访问名称及主题过渡截图时机 |

UI 自动化还覆盖：renderer 不暴露 Node `require`、停止保留片段、复制到系统剪贴板、Markdown 导出内容、重命名、搜索、每会话草稿恢复、中文输入法候选确认不误发、Shift+Enter 换行、窗口收窄无横向页面溢出。

## 本机安装

已安装到 `/Users/liqing93/Applications/知行.app`，通过已安装应用的设置接口选择 `deepseek-api`，重新载入后界面确认「已找到 API 配置」。通过系统 `open` 命令正常打开应用。桌面数据使用独立 `Zhixing` 系统应用目录，未迁移或覆盖 CLI 学习数据。

## 构建

- 应用：`desktop/release/mac-arm64/知行.app`
- 安装包：`desktop/release/Zhixing-0.2.0-mac-arm64.dmg`，156658913 字节。
- ZIP：`desktop/release/Zhixing-0.2.0-mac-arm64.zip`，164878145 字节。
- Electron 44.2.0、Pi 0.80.7、electron-builder 26.15.3；应用最低 macOS 13.0，arm64。
- Electron 官方下载在当前网络多次失败，改从镜像获取；使用官方 npm 包 `checksums.json` 验证 SHA-256 完全一致，未跳过验证。
- 构建与测试产物已加入忽略规则，不会被打入源码提交；应用只包含编译后的桌面程序和运行依赖。

SHA-256：

```text
DMG e69b5158a6c9315709bbe434544af5208f2eda1e55094c5a2777609bcccec572
ZIP ce150979810f48a453f13f1807713cadf7105adad83964b5b735fce566300134
```

## 关键边界与修复

- Electron renderer 使用 sandbox、context isolation、CSP、本地自定义协议；禁用任意导航、新窗口、远程图片与权限申请。主进程校验调用窗口、frame、URL、参数和长度。
- 桌面调用复用两个已有 Provider adapter；Pi 保留审查过的守卫和空工具列表，DeepSeek 只发送当前会话有限上下文。显式禁用联网的总开关继续生效。
- 完整显示历史与模型上下文分别管理：会话最多 1000 条消息，模型历史最多 24 条/48,000 字符；没有静默删掉最早对话。
- 本地数据写入独立系统应用目录 `Zhixing`，原子保存，拒绝文件/会话目录符号链接，损坏记录不自动删除；重启后把运行中回答显示为中断。
- 修复设置快速切换的写入顺序和过期响应覆盖，以及发送期间输入新草稿可能被迟到响应清空的问题。
- Keychain 配置状态仅检查元数据；密钥只在受控 API 调用内使用，不进入工具输出、聊天历史或配置 JSON。新增 API 配置通过 Electron 异步 safeStorage 加密。

## 尚未验证和第一版范围

- Pi 的真实 Codex 登录仍沿用 P9 的未完成状态。内附运行时和协议测试通过不代表 Codex 认证已经恢复；本次未反复调用 Pi 登录失败链路。
- Windows 提供 NSIS 构建配置，但未在 Windows 实机构建/运行。没有生成或声称存在已验证的 Windows 安装包；Intel Mac 同样未验收。
- 没有 Apple Developer ID 签名、公证或自动更新发布。此版本是可本地安装运行的预览版；公开分发需补充签名和平台验收。
- 新密钥加密抽象用测试 cipher 验证，Electron 系统加密 API 已类型检查；本次真实调用复用了已有 Keychain，没有改写用户的密钥或执行真实新密钥保存。
- 第一版桌面覆盖学习对话。既有课程、资料导入、检索工具和进度管理仍在 CLI，并未假称已全部搬入桌面。
