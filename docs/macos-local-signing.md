# macOS 本地签名与钥匙串授权

## 为什么“始终允许”之后还会询问

macOS 依据应用的代码签名要求（designated requirement，DR）记住钥匙串访问许可。临时签名 `codesign --sign -` 的 DR 只包含当前构建的代码哈希；改动程序并重新打包后，哈希会变。相同的应用名称和 `com.zhixing.desktop` 标识不足以保持授权连续性。

2026-09-10 检查确认：本机 0.10 已安装应用和 0.11 测试应用都是 ad-hoc，DR 不同。旧包的原生加密初始化成功，新包此前等待授权超时；用户随后确认新包确实出现钥匙串密码提示。这是打包身份连续性缺陷，不应要求用户靠反复授权解决。

依据：[Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)、[Apple 代码签名要求](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/RequirementLang/RequirementLang.html)。固定签名不能阻止钥匙串锁定、用户撤销许可或换证书后合理的系统询问。

## 一次性本地设置

本地开发可以使用专用的自签名代码签名证书，不需要付费开发者账号。对外分发仍使用 Developer ID 签名及公证。

已有专用证书时先执行第 4 步，检查其用途、关联私钥及代码签名信任；列表为空不代表没有创建过证书。只有确认缺少合适身份时才执行创建步骤。

1. 打开“钥匙串访问”→“证书助理”→“创建证书”。
2. 名称填写 `Zhixing Local Code Signing`，身份类型选择“自签名根证书”，证书类型必须选择“代码签名”（向导默认是 S/MIME 电子邮件）。创建前再次核对用途；名称并不能决定用途。创建到本人的“登录”钥匙串。私钥由系统生成并保管，不导出 `.p12` 或私钥文件。
3. 如下方命令没有列出它，在“我的证书”中打开该证书的“信任”，仅将“代码签名”设为“始终信任”，关闭并完成系统确认。不要把所有用途设为始终信任，不修改系统根证书。代码签名证书不使用现有的公司 TLS/客户端认证证书。
4. 查看可用的代码签名身份：

   ```bash
   npm --prefix desktop run signing:configure -- --list
   ```

5. 用列表中该证书的完整 40 位 SHA-1 指纹固定本机配置：

   ```bash
   npm --prefix desktop run signing:configure -- <证书的完整指纹>
   npm --prefix desktop run pack
   ```

本机配置保存在被 Git 忽略的 `desktop/.local/macos-signing.json`，只包含公开证书指纹。以后打包自动复用。若出现 `/usr/bin/codesign` 使用该专用私钥的系统询问，由本机用户确认；不要开放“所有应用”访问。首次从旧临时签名迁移到新固定签名时，知行访问既有加密存储可能仍需一次授权。

创建步骤参见 [Apple 钥匙串访问指南](https://support.apple.com/en-ie/guide/keychain-access/kyca8916/mac)。本地自签名不等于 Apple 开发者身份，不提供公开发行的 Gatekeeper 信任或公证。

## 打包行为

- `pack`、`dist:mac`、`dist:win` 和 `dist:host` 共用 `scripts/dist.mjs`。在修改已有包前进行签名预检；在对应操作系统上构建，验证原生模块。
- 本地签名使用 Electron 官方 `@electron/osx-sign` 按由内到外顺序处理嵌套代码。主应用的 DR 同时固定应用标识与证书指纹；不使用只有应用名的宽松要求。
- 签名后进行 `codesign --verify --deep --strict` 和 DR 精确检查。electron-builder 的自动签名发现被禁用，不能在 hook 后改用另一张证书。
- 证书失效、丢失私钥、配置损坏，或环境变量与固定配置冲突时失败，不回退到 ad-hoc。有效期到期前应规划换证；本地模式精确绑定证书，换证需要重新授权。
- `ZHIXING_LOCAL_SIGNING_IDENTITY=<完整指纹>` 可用于没有本地配置的专用构建环境；已有配置时必须匹配。
- `ZHIXING_SIGN_MACOS=1` 继续走现有 Developer ID / 公证流程，要求原有发行配置完整，不读取本地签名配置，不应同时设置本地身份环境变量。
- 仅临时 CI / 一次性验收包可以显式设置 `ZHIXING_ALLOW_ADHOC=1`。已有固定本地配置时此变量不能降级签名；这类临时包不承诺更新后的钥匙串许可连续性。CI 已显式标记未签名发行预览。

## 验收边界

自动测试覆盖身份固定、配置冲突、失效/缺失证书、严格 DR、禁止自动换证、显式临时包以及正式发行分支。完整工程检查不能替代本机钥匙串验收。

完整本机验收还需：同一证书签出两个内容不同的实际应用；核对 DR 相同而代码哈希不同；首次允许后，验证原生加密读写、重启和第二个构建；最后通过产品“测试连接”检查现有 Kimi 配置。不得读取、打印或导出真实 API Key。若尚未完成，应将状态记为“代码完成，本机跨构建授权验收待完成”。

2026-09-10 本机已完成固定证书配置、两个不同构建的 DR 连续性、原生合成密文跨重启/跨构建读取及既有两家 API 真实连接检查。重复弹窗的用户观察仍待确认；具体结果见[验收记录](evidence/keychain-signing-fix-20260910.md)。
