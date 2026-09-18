# 预览与正式发行门禁

2026-09-18。`desktop-release` 手动运行默认 `preview`，可显式选 `formal`；`v*` 版本标签强制 formal，不能用 preview 覆盖。缺少正式凭据会失败，不生成看起来完成公证的预览发行。不会自动新建证书。

## 构建条件

- macOS formal：配置 `MAC_CSC_LINK`、对应密码（如有）、`APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`。builder 强制签名、hardened runtime 和公证；之后独立检查 Developer ID、codesign、stapler 和 Gatekeeper。现有固定本地开发证书只用于本地预览。
- Windows formal：配置 `WIN_CSC_LINK` 和对应密码（如有），强制签名。验收安装后可执行文件与 NSIS 安装器的 Authenticode 有效性、时间戳及同一签署者。有效签名不保证 SmartScreen 已积累信誉。
- 当前依赖 electron-builder 26，采用对应版本配置。参考 [v26 macOS 配置](https://www.electron.build/v26/docs/mac/)与 [v26 Windows 配置](https://www.electron.build/v26/docs/win/)；不要直接套用 v27 迁移后的配置字段。

## 验收链路

1. 读取真实 Mach-O/PE 架构、app.asar 内版本及打包构建哈希，记录可执行文件和资源哈希。
2. 对同一实际可执行文件运行七组 UI 检查，逐组成功才保存 passed；检查前后哈希须相同。此处模型接口为隔离夹具，不能证明真实 Provider 质量。
3. 对同一包执行原生安全存储双进程探针；OS、架构、构建与二进制哈希必须匹配，开发运行时或缺失回执不能冒充实包结果。
4. formal 另外校验完整发行内容。Mac DMG 只读挂载后比对整个应用文件/符号链接清单；ZIP 按条目流式比对同一清单，完全不解压归档路径，拒绝多余/缺失/改动或越界条目（Apple 元数据单列忽略）。Windows 使用实际 NSIS 安装回执核对安装器哈希、构建及已安装核心资源，再验证签名。
5. 每个平台生成独立 release-acceptance 回执。标签创建草稿前，必须收齐 Mac arm64、Mac x64、Windows x64 三份 formal 回执、同一源码哈希及五个发行文件，并重新计算下载后文件哈希。只生成可审阅草稿，不自动发布。

Mac 卷若无法卸载，校验失败并保留本次自建挂载目录，不递归清理仍挂载的卷。预览不要求 Developer ID/公证，但仍要求实包 UI 与原生存储通过；`formalReady` 永远为 false。失败回执由 CI 单独上传。

## 本地核验

先将 `ZHIXING_DESKTOP_EXECUTABLE` 指向待验收包内可执行文件，再运行（回执文件必须不存在）：

```sh
node desktop/scripts/verify-packaged-ui.mjs --output=packaged-ui.json
node desktop/scripts/probe-secure-store.mjs --output=native-storage.json
ZHIXING_RELEASE_CHANNEL=formal node desktop/scripts/verify-release.mjs --ui=packaged-ui.json --storage=native-storage.json --output=formal-acceptance.json
```

最后一步检查 desktop/release 下对应版本/架构的产物，可用 `--artifacts=` 显式指定本次产物目录。失败会写回执并返回非零。正式凭据配置只经用户/CI 密钥系统，不写入仓库、聊天或回执。

本轮真实 Mac 包的七组 UI 已通过，但系统存储初始化超时，且为本地开发签名、没有对应正式发行产物/公证，因此正式门禁正确拒绝。见[实际拒绝回执](evidence/formal-release-gate-macos-20260918.json)。这证明门禁识别当前不足，不证明正式发行已经完成。Windows、Mac Intel、Linux 原生检查仍以对应 OS 的真实 CI 回执为准。
