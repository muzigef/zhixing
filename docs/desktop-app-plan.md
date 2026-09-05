> 本文件保留 P10 首版设计与当时限制；P11/0.3 已实现共享学习工作区、任务与证据流程，当前契约见 [升级指南](agent-upgrade.md)，最新验收见 [Evidence](evidence/agent-upgrade.md)。

# P10：知行桌面版

## 第一版范围

2026-09-05 的 P10 已完成 macOS Apple Silicon 本地预览验收，代码提交为 `6b87f51`，桌面包版本 `0.2.0`。设计与交互参考 Codex；Windows 当前仅提供构建配置。

用户补充要求至少支持 Pi Codex 和已有 DeepSeek API 两种方式切换；此要求纳入第一版。

第一版包含自然多轮对话、完整本地会话历史、流式回答、停止/继续/重试、会话搜索与重命名、Markdown 导出、代码复制、数学公式、Pi Codex / DeepSeek API 切换、配置继承、离线演示、浅色/深色/系统主题。既有课程、资料库、主题进度仍通过 CLI 使用；没有伪装成可用的空白导航入口。

## 交互与视觉约定

- 桌面三段结构：244px 会话侧栏、可滚动的中央对话、固定底部输入框；内容最大约 780px。
- 低饱和暖灰背景，细边框、少量阴影、明确的文字层级；采用系统中文字体。
- 首屏用三个可编辑提示帮助开始学习，不自动发送预设内容。
- Enter 发送、Shift+Enter 换行、中文输入法候选确认不误发送。Cmd/Ctrl+N 新对话、Cmd/Ctrl+K 搜索、Cmd/Ctrl+, 设置。
- 回答流式展示；生成中输入框可编辑，停止保留部分回答。切换会话不串流；有其他会话运行时提供返回入口。
- 滚动阅读历史时不强拉到底部。草稿按会话保存，重启后恢复。
- 所有按钮有可访问名称，对话框使用原生 dialog 的焦点约束，尊重系统减少动画偏好。
- 明确区分真实模型、离线演示和未完成回答；不将读取到模型配置视为登录成功。

## 实现边界

Electron 提供安装包、应用数据路径和原生窗口；React renderer 不具有 Node 或文件系统权限。受限 preload 仅开放类型化命令与对话事件；主进程校验来源、消息结构、长度和 UUID。页面使用本地自定义协议、CSP，关闭任意导航、新窗口、远程图片与权限申请。

复用 `src/pi-client.ts` 和 `src/deepseek-client.ts` 的协议校验、超时、取消、脱敏和联网总开关，以及 `responseGuidelines`。桌面内附 Pi 0.80.7，通过 Electron 的 Node 运行模式启动，不需要系统 bash/Node/Pi 可执行文件；显式载入同一审查过的工具守卫，工具列表为空。Pi 负责认证，界面只接触模型偏好与文本事件。

桌面将 `userData` 指定为系统 `appData` 下的 `Zhixing`，与 CLI 数据分开。每个会话原子写入独立 JSON，最多 1,000 条消息、12,000,000 字节，达到上限需新建会话；模型只发送最近最多 24 条、48,000 字符历史，当前请求另计。上下文裁剪不删除会话历史。API Key 系统加密，普通聊天 JSON 与草稿没有应用级加密。

CLI 调用系统安装的 Pi，桌面调用内附 Pi，两者的项目工作目录不同；桌面只自动继承全局 Pi 偏好及自身 runtime 目录的项目设置，详情见 [配置](CONFIGURATION.md#pi-codex-接入)。界面没有内置 Pi 登录流程，需要先在 Pi 完成认证。

## 验证与交付

1. 会话服务先写失败测试，覆盖持续流、取消、历史、隔离、恢复、协议失败和输入边界。
2. 完整仓库质量门，以及桌面 TypeScript 检查。
3. Playwright 启动真实 Electron，在隔离临时目录验证 UI、重启持久化、数学、暗色与窄窗口；不触发真实模型请求。
4. 生成实际 macOS 应用、DMG、ZIP，验证打包应用可运行与内附 Pi 运行环境。
5. 记录尚未验证的平台、签名分发与真实 Pi 登录状态。

工程依据：[Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)、[Electron 应用分发](https://www.electronjs.org/docs/latest/tutorial/application-distribution)。

DeepSeek 自动检查现有知行钥匙串引用是否存在；只有实际 API 调用才获取密钥。新配置使用 Electron 异步 safeStorage 加密，密钥不写入普通设置或消息。密码输入只在当前设置对话框内存中存在，保存后清空。

实际验证结果、产物校验值和未验证项见 [P10 验收](evidence/desktop-app.md)。Mac 安装包为无 Developer ID 签名/公证的本地预览，源码仓库不包含安装包；Windows、Intel Mac、真实新 Key 系统加密往返与 Pi 登录恢复仍需单独验收。
