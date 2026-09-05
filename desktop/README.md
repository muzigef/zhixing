# 知行桌面版

可安装的本地学习对话应用。第一版交付 macOS Apple Silicon 安装包；Windows 已提供独立构建配置，尚未在 Windows 实机验收。

## 安装和使用

在 `release/` 中打开 `Zhixing-0.2.0-mac-arm64.dmg`，将「知行」拖入 Applications，之后从启动台或 Finder 打开。应用包含 Electron 与 Pi 运行环境，不需要通过终端启动，也不需要安装 Node.js。

设置中可以切换：

- **Pi · Codex**：继承 `~/.pi/agent/settings.json` 的 Codex 模型偏好，认证由 Pi 处理。已有登录可直接复用；没有登录时，在 Pi 中完成 `/login` 后再试。
- **DeepSeek API**：自动识别原知行在 macOS 钥匙串中保存的 API 配置。也可在设置中输入新 Key，由操作系统加密后保存。支持 V4 Flash / V4 Pro 选择。
- **离线演示**：验证界面和交互，不调用真实模型。

切换模型会保留当前对话。Codex 回答失败时，消息下方提供「切换到 DeepSeek 重试」。每条回答标注实际使用的方式；首字/总耗时分别显示。

支持会话搜索、重命名、Markdown 导出、代码/回答复制、数学公式、停止/继续/重试、每会话草稿、浅色/深色主题。Enter 发送，Shift+Enter 换行；Cmd/Ctrl+N 新对话，Cmd/Ctrl+K 搜索，Cmd/Ctrl+, 设置。

## 数据与当前范围

会话与偏好保存在操作系统应用数据目录 `Zhixing`，独立于 CLI 仓库数据。每个会话最多 1000 条消息，达到上限需要新建；发送给模型的历史最多 24 条、48,000 字符，历史显示不受这个上下文裁剪影响。

第一版桌面入口覆盖学习对话。课程、资料导入、引用检索、练习进度等既有功能仍通过 CLI 使用，尚未搬入桌面界面。

此本地预览构建没有 Apple Developer ID 签名和公证，尚不属于已签名的公开发布版本。正式公开分发前需完成签名、公证及相应平台验收。

## 从源码开发

使用仓库约定的 Node.js 24.8.x，在项目根目录执行：

```bash
npm ci
npm ci --prefix desktop
npm run desktop
```

在 `desktop/` 中：

```bash
npm run build
npm run typecheck
npm run test:ui
npm run dist:mac
```

`test:ui` 在隔离临时数据目录启动真实 Electron，禁用联网模型，不读取真实认证。测试涵盖独立 Pi 运行环境（清空 PATH）、流式文本、数学、复制、导出、取消、历史、草稿、中文输入法、模型切换、设置恢复和窄窗口。

若需要复测最终 `.app`：

```bash
ZHIXING_DESKTOP_EXECUTABLE="$PWD/release/mac-arm64/知行.app/Contents/MacOS/知行" npm run test:ui
```

在 Windows 构建机执行相同的依赖安装及 `npm run dist:win` 生成 NSIS 安装包。`electronDist` 使用本机平台的 Electron，不能直接在 Mac 上用此配置假装产生已验证的 Windows 包。

Electron 下载受代理影响时，可配置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/` 后重试安装。必须保留 Electron 官方 checksum 校验，不使用跳过校验的选项。

## 结构

- `core/`：输入契约、会话服务、原子存储、加密存储抽象。
- `electron/`：原生窗口、受限 IPC、Pi 打包启动、系统钥匙串衔接。
- `renderer/`：React 聊天界面与本地 Markdown / KaTeX 渲染。
- `scripts/`：构建、UI 验证、图标生成及可选 DeepSeek 连通检查。

复用仓库 `src/pi-client.ts`、`src/deepseek-client.ts`、`responseGuidelines` 的协议校验与对话规则。Pi 禁止模型工具执行，主进程只向 renderer 提供受校验的命令与消息；凭据不会回传到 renderer。
