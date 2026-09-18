# 原生安全存储 CI 与合并前复验

日期：2026-09-18。题库 26 项开发提交 `d371da6` 后，合并检查发现原生存储 CI 失败，先在功能分支修复；历史失败回执保留。未替换已安装 App，未使用真实 API Key 或调用模型。

## 故障与修复

1. [首次原生存储 CI](https://github.com/muzigef/zhixing/actions/runs/35317850311)：macOS、Windows 初始化 45 秒超时，Linux 提前退出。源码的 Electron ESM 入口顶层等待整个探针，探针又等待 `app.whenReady()`，形成启动等待循环；并非凭该超时即可判断钥匙串权限不足。新增启动回归先复现失败，再验证模块在 ready 前加载结束、ready 后执行探针、正常产品入口不执行。
2. `8c3d104` 将临时目录校验和 userData 设置放在 ready 前完成，后续探针用 ready 回调执行；Linux 转发 Xvfb 的 `XAUTHORITY`，回执增加退出信号及有界错误分类，不输出原始错误内容。[第二次原生 CI](https://github.com/muzigef/zhixing/actions/runs/35319239089) 的 macOS、Windows 双进程检查通过，Linux 仍以 `SIGTRAP` 退出。Electron 的加载时序依据见[官方 ESM 文档](https://www.electronjs.org/docs/latest/tutorial/esm)。
3. `1386731` 为 Ubuntu 24.04 runner 的确切 Electron 可执行路径提供 AppArmor `userns` 规则，保留 Chromium 沙箱；没有使用 `--no-sandbox` 或关闭系统级限制。这是 CI 运行环境配置，不能称为 Linux 安装包已交付；背景见 [Ubuntu 官方命名空间说明](https://ubuntu.com/blog/ubuntu-23-10-restricted-unprivileged-user-namespaces)。初次 Linux 回执只有提前退出，第二次只有 `SIGTRAP`，不据此虚构原始内核拒绝日志。
4. [同期 Windows 沙箱 CI](https://github.com/muzigef/zhixing/actions/runs/35319239294) 的取消测试在触发取消前耗尽 10 秒准备预算。`1386731` 改用小型真实 stdlib ZIP 到达同一取消边界，继续验证 AbortError 与私有目录清理；完整真实 Python 标准库和边界执行仍由独立用例覆盖，没有放宽产品超时或忽略失败。

## 本地已验证

- `8c3d104` 对应应用修复：完整 `CI=1 npm run verify` 通过 195 个文件 / 1,023 项测试；integration 9 项和 eval 6 项已包含在全量中，不能重复相加。七组桌面 UI 全部通过。
- 本机 macOS arm64 开发构建真实双进程加密、重启解密、密文不含原文、畸形密文拒绝通过，见[原生回执](native-secure-store-macos-startup-fix-20260918.json)。该回执绑定自身构建哈希，`packaged=false`，不能代替固定签名安装包的正式发行验收。
- 完整验证日志 SHA-256：`836c2e0d2e1e5f4c62b24c8c6a4cfb36060a2fa97a6c9d65e9e01cfc81bd6bf7`；桌面 UI 日志 SHA-256：`452c11d9d65d59730666ee4279b27ab72bc244aff1502efbcc694122fefe001c`。

## 外部条件

本记录不改变 Kimi 扩展团队对照未启动、真实学习者/独立人评/72 小时随访未开展、正式签名公证和安装交付待验收的事实。系统密码库首次授权仍由 OS 决定；开发构建探针通过不保证用户不同安装版本间永久免授权。

## 最新修复提交复验

`1386731` 的本地完整 verify 再次通过：195 个测试文件 / 1,023 项；日志 SHA-256 为 `8b6a1072a504252ce4f7ed8aad82161e9e76efdcab0dd1f9d2215ce536594707`。应用主进程自 `8c3d104` 后未变更，保留上面的七组 UI 证据。

- [三平台原生安全存储](https://github.com/muzigef/zhixing/actions/runs/35319648373) 全部成功：macOS Keychain、Windows DPAPI、Ubuntu 24.04 GNOME libsecret 均通过真实加密与新进程解密；Linux 另通过 basic_text 拒绝。原始四份 artifact 内容及哈希见[三平台回执](native-secure-store-three-platforms-20260918.json)。这些均为 `packaged=false` 的开发构建。
- [四平台执行沙箱](https://github.com/muzigef/zhixing/actions/runs/35319648459) 全部成功，包含修正后的 Windows 取消用例。未将该测试的合成 stdlib 归档误称为完整 Python 运行时验收。
- [远端完整 verify 与桌面 UI](https://github.com/muzigef/zhixing/actions/runs/35319648361) 成功，绑定同一修复提交 `1386731`。

## 合并

已将 `d371da6` → `8c3d104` → `1386731` 按原顺序快进合并至 main，无冲突、无历史改写。后续文档提交仅同步本记录、原生回执和现行状态，不改动已验证的应用源码。main 推送触发的新 CI 与以上已完成的功能分支检查分开报告。

本机源码指纹还包含两个被 Git 忽略的本地主题计划，因此不把本机整体 codeHash 当作远端指纹。已从 `git archive 1386731` 重建干净源码快照，其哈希 `dd245a516efdb19a68daf2765aabedda78b5ed604aed0b7d0a1f35e771da2b76` 与远端 macOS/Linux 原生构建一致；这些本地主题计划未纳入提交，Windows 继续使用其独立构建回执，不跨平台替换哈希。

本次合并文档检查：9 个改动文件中的 462 个本地链接均存在（未校验锚点），JSON 解析、敏感内容模式扫描和 diff 空白检查通过。
