# 内部报告格式冲突修复与回归

日期：2026-09-10。当前状态：完整工程门禁 723 项及最终实际包七组 UI 通过；该包原生加密初始化再次等待系统授权，旧题真实回归尚未开始，未替换安装应用。新题成绩见[32 任务报告](team-quality-v3-comparison-20260910.md)，不覆盖该次结果。

## 可复现问题与修改

冻结新题运行完成后检查到：内部报告的修正也走通用“遵守用户篇幅和格式要求”提示；成员、分工和审查的最近用户消息是原题，其中可能要求最终答案字段。这与内部报告 schema 冲突。原始真实失败仅保留 `invalid_report`，没有被拒绝文本，故不将所有旧失败追认成特定类型错误。

- 所有内部阶段把原对话明确标为待分析任务数据，追加当前内部 JSON 指令；主 Agent 最终请求保持原用户要求。图片保留适配器允许的 user 消息角色，附同样的数据边界说明；不扩大图片或工具权限。
- 共享模型执行层区分最终回答与内部协议修正。内部修正不再引入相矛盾的最终输出要求；原有一次自动修正限制、恢复计数、取消和预算继续生效。
- 校验错误包含有界字段路径与类型/长度类别，拒绝类型错误、重复 key、额外字段、超限和语法错误，不宽松解析或默默丢弃证据。错误提示不引用模型值、任意未知字段名称或上游异常。
- 仅固定合成评测的请求记录增加 `reportIssue`；只保存校验元数据，不保存拒绝的报告原文，不修改最终答案评分或完成定义。

## 测试与过程

先加入三项内部契约测试，实际 3 项失败后实施修复；随后加入脱敏诊断测试，实际失败后接入记录；图片传输复查加入全阶段图片测试，实际失败后保留图片所需角色。

- 三项契约失败日志：`/tmp/zhixing-internal-contract-red.log`。
- 修复后内部协议、团队协调、恢复计数定向 25/25 通过：`/tmp/zhixing-internal-contract-targeted.log`。
- 诊断测试失败与修复后 18/18：`/tmp/zhixing-report-diagnostics-red.log`、`/tmp/zhixing-report-diagnostics-green.log`。
- 第一轮完整 `CI=1 npm run verify` 通过 144 文件 / 722 测试、integration 9、eval 6 及其余门禁：`/tmp/zhixing-team-contract-final-verify.log`。
- 图片边界失败后，团队/图片/评测定向 22/22 通过：`/tmp/zhixing-team-image-red.log`、`/tmp/zhixing-team-contract-image-green.log`。第一版打包完成但未安装，也未用于真实回归；最终包应包含这项修复。

## 旧题回归计划（请求前记录）

最终工程与实际包检查通过后，以相同三家模型、原有档位/预算/代理运行 H02/H04 × 四组各一次，共 8 根任务。使用 `evaluate-team.mjs --live --suite=regression`，保存完整新文件，不挑选结果，不将旧题作为未见留出，不覆盖 32 新题报告。核查内部协议完成率、脱敏失败原因、最终字段与解释；所有失败保留。实际新包哈希另存来源回执。

本次改动解决明确的协议和图片兼容问题；是否消除真实模型报告失败需要以上实际回归。更广泛的质量优势仍需新的独立样本与评阅，不能因单次回归通过就宣布团队比单 Agent 更强。

## 最终工程与系统授权状态

- `CI=1 npm run verify` 退出 0：144 文件 / **723 测试**，integration 9、eval 6、mock smoke、两套类型检查、lint、敏感扫描及 diff 检查通过。日志 `/tmp/zhixing-team-contract-image-verify.log`。
- `npm --prefix desktop run pack` 退出 0，固定签名和严格校验通过。最终 app.asar SHA-256 为 `fae1a8ee33c5853a3b20b84d3f6c0f21742af9c345143f6ee126e50bb4bd4135`。主应用与 Helper 仍分别绑定同一固定叶证书；[构建来源](team-quality-contract-build-20260910.json)保留完整源码清单。
- 指定实际包、`ZHIXING_DESKTOP_NATIVE_CIPHER=0` 的七组 UI **退出 0**，包括团队选择、部分失败和恢复。日志 `/tmp/zhixing-team-contract-delivery-ui-without-native.log`。HTTP 和 cipher 为隔离夹具，不能代替真实 Keychain。
- 先前启用原生 cipher 的实际包 UI 在 `isAsyncEncryptionAvailable()` 阶段等待未返回，超过 IPC 的 20 秒期限后，退出清理又等待原生调用结束；系统 `SecurityAgent` 同时出现，当前仍待用户操作。日志 `/tmp/zhixing-team-contract-delivery-ui.log` 保留，不能标为通过。
- Computer Use 对系统授权应用 `com.apple.SecurityAgent` 返回明确的安全限制，无法查看或操作其窗口；未使用替代 UI/脚本绕过。已向用户询问是否看到知行钥匙串弹窗及所选按钮，不索取系统密码。

因此，稳定签名及早期两个构建的成功解密仍是有效历史证据，但**最新包无重复弹窗尚未验收**。还需确认这次请求的具体钥匙串项与用户选择，不能仅凭相同 DR 宣布问题彻底解决，也不应重新创建或删除证书。待该系统窗口处理后，补验原生跨构建解密、执行上方 8 个旧题任务及解释核对，再完成安装交付。当前已安装版本仍为 0.10.0。
