# 平台安全存储与原生验收

2026-09-18。API Key 仍只由主进程经 EncryptedDesktopSecrets 保存；renderer 只得到配置状态。以下是适配能力，不代表所有 OS 均已在本轮真实跑通。

| 平台 | 接口与后端 | 拒绝条件 |
| --- | --- | --- |
| macOS | Electron async safeStorage / Keychain | 系统加密不可用或解密失败 |
| Windows | Electron async safeStorage / DPAPI | 系统加密不可用或解密失败 |
| Linux | Electron sync safeStorage / GNOME libsecret、KWallet 4/5/6 | basic_text、unknown、未列出的后端、服务不可用 |

Linux 的 `getSelectedStorageBackend()` 标识同步接口的后端，不能证明异步接口用了同一个后端。因此仅对 Linux 采用可观测的同步路径；可能等待桌面密码库解锁，不保证无阻塞。异步 Linux 的回退保护未能确认时不启用。其他平台保留异步接口；每次加解密都重新核对可用性，失败不写明文。Windows DPAPI 不隔离同一登录用户的其他进程。依据 [Electron safeStorage 官方说明](https://www.electronjs.org/docs/latest/api/safe-storage)。

## 真实进程探针

```sh
npm --prefix desktop run prepare:runtime
npm --prefix desktop run build
node desktop/scripts/probe-secure-store.mjs --output=new-native-receipt.json
```

如已构建实包，可设置 `ZHIXING_DESKTOP_EXECUTABLE` 为该包的可执行文件，再运行相同命令。探针在独立临时目录用公开合成值测试加密、密文中无原文、另一个进程重启解密、畸形密文拒绝；不读取原有 API 配置、旧钥匙串条目，不请求真实模型。两阶段须均成功；45 秒初始化超时会保存失败回执并清理本次进程/目录。

回执保存实际 OS/架构、Electron 版本、是否打包、可执行文件哈希、构建哈希和选中后端；不输出合成值或密文。它验证的是该机器与该构建的行为，不是密文抗攻击证明、跨用户隔离测试或钥匙串授权永久稳定证明。系统首次访问仍可能需要用户在系统窗口操作，不能由产品权限开关绕过。

Linux 可运行 `--expect-basic-denied`，强制 basic_text 并确认在写入前拒绝。它不能替代有真实 Secret Service 的正向测试。

## CI 与边界

`.github/workflows/native-secure-store.yml` 在 macOS、Windows、Ubuntu 原生 runner 上执行上述探针；Linux 在独立 D-Bus 会话中启动 GNOME Keyring，并额外验证拒绝明文回退。发布流程还会对 macOS / Windows **实际打包或安装后的可执行文件**运行双进程探针。日志与 JSON 分别保留，runner 尚未运行时不得声称该平台通过。

当前安装包目标仍为 macOS、Windows；Linux 原生存储测试不等于已有正式 Linux 安装包。KWallet 的规则测试不等于每一种桌面环境已实测。实际运行结果见[本轮证据](evidence/interview-improvements-20260918.md)。
