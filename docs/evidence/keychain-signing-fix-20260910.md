# 反复钥匙串授权：签名修复记录

> 历史验收快照：下文的测试数量、失败、安装及“待验”状态仅适用于记录当次执行；未重新运行或改写历史结果。当前实现与后续进展见 [当前状态](../current-status.md) 和 [证据索引](README.md)。

日期：2026-09-10。当前状态：固定证书已配置，早期两个实际包的重启及跨构建原生解密、既有两家 API 真实连接通过；后续团队协议补修包虽然 DR 不变，原生初始化仍等待系统授权，重复弹窗问题尚未完整验收。最新包 723 项测试及七组隔离 UI 通过，尚未替换已安装应用。下文保留各阶段的失败与待验历史。

## 实际原因与边界

通过 `codesign -d -r-` 核对两个现有产物：标识均为 `com.zhixing.desktop`，均是 ad-hoc 且没有 TeamIdentifier。

| 产物 | 指定代码要求 |
| --- | --- |
| 已安装 0.10.0 | `cdhash H"ca903e598cebb320a9029cae34a0484719b6c903"` |
| 0.11.0 团队测试包 | `cdhash H"c92224e56bf64d497667a946f48b70454b1eef0d"` |

旧流程每次打包执行 `codesign --force --deep --sign -`。不同哈希意味着之前的“始终允许”不能稳定延续到新包。[Electron 文档](https://www.electronjs.org/docs/latest/api/safe-storage)明确要求 macOS 加密存储配合持续一致的代码签名；[Apple 要求语言文档](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/RequirementLang/RequirementLang.html)说明 ad-hoc 与代码哈希标识的范围。

用户确认 Kimi 测试连接出现密码及“始终允许”提示。此前同包 Kimi 原生初始化超时、旧包原生初始化成功的历史观测保留在 [native check](team-quality-native-check-20260910.json)，不能追改为当时已定位签名原因。签名连续性是已确认的工程缺陷；锁定钥匙串、撤销权限等其他系统状态仍可能产生合理提示，不能承诺任何情况下都不询问。

本机 `security find-identity -v -p codesigning` 返回 **0 个有效代码签名身份**。现有同名个人/公司证书并非代码签名用途，不复用。只查看公共证书身份元数据，没有读取、输出或导出 API Key、钥匙串密码或私钥。

## 修改

- macOS 打包入口统一，先验证固定身份，再准备运行时或改动旧包。
- 本地配置仅保存完整证书指纹，拒绝静默换证、失效证书、配置损坏与冲突；没有配置时要求显式设置。
- 使用已有 Electron 官方签名库（现固定为直接开发依赖 `@electron/osx-sign@1.3.3`）按嵌套顺序签名。主应用要求同时固定标识和证书；签后严格验证，防止退化为仅凭应用名或构建哈希识别。
- 禁止 electron-builder 在 hook 后自动选择别的证书。本地开发证书与正式 Developer ID / 公证分支分开。
- 临时 ad-hoc 只允许显式 `ZHIXING_ALLOW_ADHOC=1`，CI 预览已更新。已固定的本地身份不能被该开关降级。
- 不改变 API Key 存储，不扩大现有钥匙串项的 ACL，不把原生加密改为明文或通用命令读取。
- 设置说明见 [macOS 本地签名](../macos-local-signing.md)。已打开证书助理，填写 `Zhixing Local Development`，选择“自签名根证书 / 代码签名”，停在“创建”按钮之前。证书创建及必要的系统确认由用户完成。

## 本次真实工程检查

| 检查 | 结果 |
| --- | --- |
| 新测试先于实现 | 两次新增模块缺失导致定向测试失败，随后实现 |
| `npx vitest run tests/desktop-signing.test.js` | 12/12 通过 |
| `npm --prefix desktop run pack`，无签名配置 | 预期退出 1，`macos_signing_not_configured`，未开始构建或覆盖旧包 |
| `npm run verify`，默认本机并行 | 第一次 715/716，备份恢复 5 秒超时；第二次 714/716，备份恢复及权限撤销两个多进程测试 5 秒超时 |
| 备份恢复/签名定向复查 | 22/22 通过，备份恢复单项 963ms；未修改断言或超时 |
| `CI=1 npm run verify` | 退出 0：144 文件 / 716 测试，integration 9、eval 6、mock smoke、两套类型检查、lint、敏感扫描及 diff 检查全部通过 |
| `npm --prefix desktop run test:ui` | 退出 0，七组开发目录 UI 通过；HTTP/加密为隔离夹具，不是系统授权验收 |
| `node scripts/check-lockfiles.mjs` | 通过；锁文件仍为公开 HTTPS registry |

串行使用已有 `vitest.config.ts` 的 CI 并发限制，未禁用测试、放宽超时或修改业务运行限制。默认本机并行稳定性问题仍记录在案，不能声称默认命令本轮无失败。

原始日志位于本机 `/tmp/zhixing-keychain-signing-verify.log`、`/tmp/zhixing-keychain-signing-verify-rerun.log`、`/tmp/zhixing-keychain-signing-verify-serial.log`、`/tmp/zhixing-keychain-signing-ui.log`。

## 尚未验收

1. 用户完成专用证书创建，以及必要时仅“代码签名”用途的本机信任；配置工具确认身份可用后固定指纹。
2. 同一证书签出两个内容不同的实际应用，确认代码哈希变化而 DR 不变。
3. 首次迁移授权后，在重启和第二个构建中验证原生合成加解密，再通过产品验证既有 Kimi 连接；不读取真实密钥内容。
4. 生成并验收固定签名交付包，再恢复 32 个团队新题任务及解释复核。既有团队报告和冻结问题集保持不变。

本次没有生成新的 ad-hoc 包来代替修复。现有 0.11 测试包和已安装 0.10 应用保持原签名；不得把代码修复或模拟签名测试宣称为实际消除弹窗。

## 用户反馈后的证书用途复查

用户指出已创建证书后，进一步核对系统公开证书元数据，发现 `Zhixing Local Development` 确实存在，指纹为 `7389C6CFDA421061D5B1D2ECA8A8FBE99FF1AD5C`。其扩展用途是 `1.3.6.1.5.5.7.3.4`（电子邮件保护），不是代码签名用途 `1.3.6.1.5.5.7.3.3`。`security find-identity -p codesigning` 的匹配身份和有效身份仍均为 0。此前将“未找到预期名称 / 没有有效签名身份”直接解释为“用户没有创建证书”不充分；应先核验已有证书的用途。

没有删除或修改已有证书，也没有扩大它的信任范围。证书助理已重新准备，名称 `Zhixing Local Code Signing`、身份类型“自签名根证书”、证书类型“代码签名”，已同时用可访问性状态和界面截图确认选项。停在“创建”之前，等待用户完成私钥创建及系统确认；此时仍不能宣称固定签名实包验收完成。

## 正确用途证书创建后的复查

用户完成创建后，确认 `Zhixing Local Code Signing` 已存在，指纹为 `45295689F7DC96DF059E2F30C503D98E57052F40`，用途为代码签名 `1.3.6.1.5.5.7.3.3`，有效期为 2026-09-10 至 2027-09-10。`security find-identity -p codesigning` 已列出关联身份，但标注 `CSSMERR_TP_NOT_TRUSTED`；有效身份列表仍为空。因此现在不需要再创建证书，下一条件是本机代码签名信任。

已在“钥匙串访问”中打开该证书并展开“信任”，定位到“代码签名”项。尚未修改信任；用户仅需将该项设为“始终信任”，其余用途保留现状，并关闭窗口完成系统确认。之后再由工具验证有效身份、固定指纹并开始实际签名。不能将证书创建成功等同于跨构建授权验收通过。

## 固定签名实包与原生连续性验收

2026-09-10 后续实际操作：仅将正确证书的“代码签名”用途设为始终信任，系统有效身份检查通过，配置工具将上述公共指纹写入被 Git 忽略的本地配置。没有再次创建证书或导出私钥。

实包暴露两个兼容问题，均先加入失败测试再修复：签名库默认使用无用途限定的有效身份查询，无法识别只信任代码签名用途的证书；macOS 输出证书哈希为小写，而签后检查预期大写。现在在签名前立即使用 `security find-identity -v -p codesigning` 严格复验身份，再交给签名库；指定要求仅规范化十六进制大小写，不放宽标识、证书或逻辑条件。两次失败构建日志保留，第三次实际构建退出 0。

| 检查 | 实际结果 |
| --- | --- |
| 签名专项 | 14/14 测试通过，含身份失效及要求被放宽的拒绝测试 |
| `CI=1 npm run verify` | 144 文件 / 718 测试、integration 9、eval 6 及其余完整门禁通过 |
| 固定证书实际 `.app` | 严格签名及指定要求检查通过，七组实包 UI 通过 |
| 同包重启读取隔离测试密文 | 成功，原生检查 10ms、合成解密总计 11ms |
| 内容变化后的第二个构建读取同一测试密文 | 成功，原生检查 8037ms、总计 8038ms；代码哈希变化、指定要求不变 |
| 产品内既有 Kimi 配置 | 真实应答成功，3.981 秒 |
| 产品内既有 DeepSeek 钥匙串配置 | 真实应答成功，1.682 秒，首字 1.619 秒 |

原生验收只保存已知合成字符串的密文，不读取真实 API Key。两个构建固定要求均为应用标识与同一叶证书的合取；哈希、时间与加密结果见[验收回执](stable-signing-acceptance-20260910.json)。证书只用于本机稳定身份，不等于 Apple Developer ID 签名或公证。

第二个构建的原生初始化约 8 秒，耗时本身不能证明是否出现了弹窗；该观察仍待用户确认，不能将成功解密表述成“已证明更新后零弹窗”。新的 32 任务团队评测已恢复运行，实际使用固定签名包；评测期间保持包及题集不变。

日志：`/tmp/zhixing-stable-signing-pack-first.log`、`/tmp/zhixing-stable-signing-pack-second.log`、`/tmp/zhixing-stable-signing-pack-final.log`、`/tmp/zhixing-stable-signing-verify.log`、`/tmp/zhixing-stable-signing-pack-ui.log`、`/tmp/zhixing-stable-signing-kimi.log`、`/tmp/zhixing-stable-signing-deepseek.log`。

## 后续构建再次等待授权

32 个新题评测完成、内部协议补修后，新包哈希为 `fae1a8ee33c5853a3b20b84d3f6c0f21742af9c345143f6ee126e50bb4bd4135`。主应用与 Helper 的 DR 均仍包含各自标识及同一固定证书，严格验签通过；但原生加密初始化未返回，系统授权进程出现。无法据此确认请求的具体钥匙串项或是否真正保存过该项的“始终允许”；当前待用户观察与系统操作。

工具出于安全原因拒绝访问 `SecurityAgent`，没有绕过这一限制或修改钥匙串 ACL。普通实际包 UI 的七组隔离检查另外通过，不能替代此系统授权结果。完整进展见[内部协议补修及最新本机状态](team-report-contract-fix-20260910.md)。[Apple 的 DR 说明](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements)及 [Electron safeStorage 文档](https://github.com/electron/electron/blob/main/docs/api/safe-storage.md)支持保持一致签名的必要性，但相同 DR 不能证明这次用户系统授权已经完成。
