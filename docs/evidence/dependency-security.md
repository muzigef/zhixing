# 依赖安全修复

日期：2026-09-05。基线：`9c4c901`。环境：macOS arm64、Node `24.8.0`、npm `11.6.2`、Electron `44.2.0`。

## 问题与改动

- 原根目录和桌面锁文件均解析为 `pdfjs-dist@5.7.284`，命中 [GHSA-hq66-cqwq-w95j](https://github.com/advisories/GHSA-hq66-cqwq-w95j)。两端固定为官方修复版本 `6.2.108`，更新相关 canvas 可选依赖与完整性信息。
- 桌面生产依赖审计另发现 Pi `0.80.7` 的 `brace-expansion@5.0.6`、`protobufjs@7.6.4`、`undici@8.5.0` 告警。上游 shrinkwrap 保持旧解析，局部 override 未能更新锁文件；最终使用 Pi `0.85.0`，其锁定版本分别为 `5.0.9`、`7.6.5`、`8.9.0`，没有保留覆盖或使用 audit force。
- UI 回归发现 Pi 新版公开命令入口为 `dist/bundle/cli.js`。旧代码直接启动内部 `dist/cli.js`，会报缺失 `@earendil-works/pi-server`。主进程现从已安装包的 `bin.pi` 解析入口，兼容开发目录及 ASAR unpack 路径，拒绝越界/缺失入口；未额外引入 server 依赖。
- `verify` 与 `desktop-release` 均审计根目录、桌面两套生产依赖，保留 high 门槛及失败退出码。更新测试指南、安全说明、当前 Pi 版本说明。
- 实包 smoke 暴露原有重试断言的时序竞争：模型选择器先更新，第二条响应异步追加，立即读取消息数量可能得到 1。测试改为等待第二条响应的实际禁联网提示，再断言消息数与 Provider；保留超时和失败检查。

## 已执行

本机默认 npm registry 不可解析，安装和 audit 均通过命令参数临时使用 `https://registry.npmjs.org`，未修改用户 npm 配置。

| 命令/检查 | 结果 |
| --- | --- |
| 修复前两套 `npm audit --omit=dev --audit-level=high --registry=https://registry.npmjs.org` | 根目录 1 high，桌面 2 moderate / 3 high，均退出 1 |
| 修复后相同审计 | 两套均报告 0 vulnerabilities，退出 0 |
| 两套 `npm ci --no-audit --no-fund --registry=https://registry.npmjs.org` | 退出 0，根目录 199、桌面 609 个包 |
| `npm run test:integration` | 9 个测试通过；文字/扫描/损坏/加密/超页数 PDF、引用和回滚 |
| Pi 入口测试先失败再修复 | 新增 4 个入口测试先失败；修复后与 Pi adapter、桌面 Provider 定向测试一起通过 |
| `npm run verify` | 退出 0；64 个文件 / 310 个测试；两套类型检查、lint、integration 9、eval 6、mock smoke、敏感扫描与 diff 检查通过 |
| `npm --prefix desktop run test:ui` | 退出 0；原有 UI smoke 与学习 UI smoke 均通过；实际内附 Pi 版本检查、PDF 导入、切换/重试与持久状态 |
| `CSC_IDENTITY_AUTO_DISCOVERY=false npm run pack -- --config.directories.output=release/security-check-20260905`（在 `desktop/`） | 退出 0；独立输出 macOS arm64 `.app`，未覆盖既有发布目录中的 DMG/ZIP |
| 打包内容与配置检查 | `.app` 中 PDF.js 为 `6.2.108`、Pi 为 `0.85.0` 且公开 bin 存在；两个工作流 YAML 与本轮文档链接检查通过 |
| 指定新 `.app` 的 `npm --prefix desktop run test:ui` | 退出 0；实际打包应用的两套 UI smoke 均通过 |

integration、eval 和 Pi 定向测试均是全量 310 个测试的子集，不重复累计。实际包检查使用 `ZHIXING_DESKTOP_EXECUTABLE` 指向 `desktop/release/security-check-20260905/mac-arm64/知行.app/Contents/MacOS/知行`。

本机命令日志位于 `/tmp/zhixing-security-{root-ci,desktop-ci,root-audit,desktop-audit,pdf-regression,pi-red,pi-green,verify,ui,package,packaged-ui}.log`；其中 `pi-red` 是预期失败的测试先行记录。远端 Actions 结果不包含在本地通过结论中。

## 范围与限制

未调用真实 Pi Codex/DeepSeek，不读取真实凭据或用户资料。测试使用临时工作区与非敏感夹具。没有改动用户全局 Pi 安装、模型偏好或认证配置。旧 DMG/ZIP 不会随源码更新而改变，本次不宣称它们已包含修复。Windows、签名/公证和远端 Actions 结果须在对应环境验收。
