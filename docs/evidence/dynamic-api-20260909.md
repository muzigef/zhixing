# 动态 API 连接与 Kimi 真实复验（2026-09-09）

> 历史验收快照：下文的测试数量、失败、安装及“待验”状态仅适用于记录当次执行；未重新运行或改写历史结果。当前实现与后续进展见 [当前状态](../current-status.md) 和 [证据索引](README.md)。

## 目标与实现

用户已在设置中保存 Kimi，希望验证可用性，并能按配置添加新模型服务。保留默认单 Agent，本轮不开发团队模式。

- `api-connection-config.ts` / `api-connections.ts`：严格的公开连接契约，最多 20 个定义；修订校验、原子写入；哈希身份绑定协议、地址、模型、能力和兼容参数，名称不影响身份。篡改同 ID 的端点会被拒绝。
- `createAgentModel` / `ChatCompletionsClient`：配置驱动创建第三方连接，复用有界 SSE、输出/上下文预算、工具续接、取消和联网总开关。只接受 OpenAI 兼容 Chat Completions / Bearer；不新增外部依赖。
- 桌面：设置中的添加、选择、改名、替换 Key、连接测试与移除；独立系统密文，Key 不回填/不进入偏好或日志。更换端点/模型需要新连接。移除配置保留密文和对话，原连接的恢复/排队任务不会自动改用其他厂商。
- CLI：`模型连接添加 <公开 JSON>`、`模型连接列表`，沿用 Keychain 隐藏输入和角色路由。与桌面使用同一工厂、AgentService 和工具策略；两端存储目录及密钥后端仍独立。
- 完整备份导出/恢复公开定义，排除密文；恢复保留本机已存在的同身份名称。诊断统计和会话 Provider 契约支持动态 ID。

配置与用户操作见[配置说明](../CONFIGURATION.md#自定义-api-连接092)。

## 真实账户验证

用户保存配置后，已安装 0.9.1 的受控 `boot` / `check-api` IPC 返回：`configured=true`、`source=desktop`、`model=kimi-k3`，请求成功。首字 **20,367 ms**，总耗时 **20,490 ms**。时间包含本机解密、网络和服务端处理，不是纯推理耗时。

`desktop/scripts/check-installed-api.mjs --live --provider=kimi-api` 只返回公开配置状态和探针耗时。应用主进程使用原有密文向 Kimi 原端点发送固定合成问题；脚本不读凭据、不输出回答或推理、不发送用户会话、资料或工具，不创建新会话。原始安全日志 `/tmp/zhixing-kimi-live-20260909.log`。

## 工程验证

已先新增配置/安全/路由测试，首次运行因模块尚不存在而失败（`/tmp/zhixing-dynamic-red.log`），随后实现。两套 `npm ci --registry=https://registry.npmjs.org` 均成功。

- `CI=1 npm run verify`：134 个文件、666 项测试通过；另运行 integration 9、eval 6、mock smoke、根/桌面类型检查、lint、锁文件校验、敏感扫描与 `git diff --check`。日志 `/tmp/zhixing-dynamic-verify-final.log`。
- 开发桌面六组 UI 全通过（`/tmp/zhixing-dynamic-ui-final.log`）。包含自定义服务添加/改名、空 Key 保留、切换、探针、对话、重启、修订冲突、移除及无回退检查。首次 UI 在重命名后因测试选择器同时匹配工具栏和设置按钮而失败，已限定设置列表，完整重跑通过；未跳过测试。
- 自定义连接契约测试包含实际 loopback HTTP 307 拒绝重定向，确认认证请求没有到达重定向目标；挂起请求可被取消。原生工具测试验证参数失败修复、真实 Harness 执行次数和断流不执行工具。
- 实际 CLI 子进程完成公开配置添加、跨重启切换和问答；普通/教学长对话逐请求对比桌面一致。移除配置后旧路由失败且不调用替代模型。
- 根目录与桌面生产依赖官方源审计均 `found 0 vulnerabilities`。
- 0.9.2 `npm --prefix desktop run pack` 成功。开发 UI 目检后仅调整设置分组与按钮样式；最终源码门禁、实际打包 UI 和安装结果在下节追加。

UI 的 HTTP 与 cipher 是隔离合成夹具；不等同真实第三方 API 成功或 OS 加密验收。真实 Kimi 结果与上述工程测试分别记录。

## 边界

同协议的服务商和模型可以直接配置；仅提供 Responses、Anthropic 原生 Messages 或其他鉴权方式的接口不在本轮支持范围。模型 ID、工具/图片能力和参数以服务商文档为准，不声称任意厂商兼容。连接测试证明文本通路，工具语义正确性仍需服务商真实调用验证。

本轮未验证新第三方真实账户、教学效果、团队质量、Windows 新版安装或正式 Developer ID 签名/公证；既有三平台记录仍是 0.9.0 历史基线。未执行 Git 提交或推送。

## 最终实包、安装与升级复验

最终样式调整后，`CI=1 npm run verify` 再次完整通过：134 文件、666 测试，integration 9、eval 6，全部检查成功。日志 `/tmp/zhixing-dynamic-verify-release.log`。`ZHIXING_DESKTOP_EXECUTABLE=.../desktop/release/mac-arm64/知行.app/Contents/MacOS/知行 npm --prefix desktop run test:ui` 对真实 0.9.2 `.app` 执行六组 UI 全通过，日志 `/tmp/zhixing-dynamic-pack-ui.log`。管理连接表单已查看实际截图，字段、说明、按钮完整，无裁切；截图只含合成数据。

已安装至 `~/Applications/知行.app`，旧 0.9.1 程序保存在 `desktop/release/installed-backups/20260909-162805/知行.app`（Git 忽略）。安装只替换程序包，未访问用户数据目录。安装前后 `.asar` 哈希一致且 `codesign --verify --deep --strict` 通过；完整[安装回执](dynamic-api-install-20260909.json)记录路径与时间。来源 `fd33cd290e7f4b998d9a35098ae7e7db7f523ab460979dbf7aff64a296af5517`，391 个源码输入均与最终工作区匹配，基于未提交的 `47c121f48aef76d32d57300798c722f88f7868f0`。

**新版安装后真实 Kimi 再验成功**：仍使用设置中的原桌面密文，`configured=true`、`source=desktop`、`model=kimi-k3`；首字与总耗时均为 **15,767 ms**，无需用户重新输入 Key。与先前 20.49 秒的差异只是两次实测，不据此宣称延迟优化。日志 `/tmp/zhixing-dynamic-installed-kimi.log`。测试退出后重新打开了已安装应用。

本次仅生成并安装 macOS arm64 `.app`；没有生成 0.9.2 DMG/ZIP 或执行 Git 提交/推送。正式签名、其他系统及真实第三方厂商边界仍如上节。

## 日志校验

临时日志不随 Git 提交，以下哈希绑定实际验证输出。

| 日志 | SHA-256 |
| --- | --- |
| `/tmp/zhixing-kimi-live-20260909.log` | `12460827e5f5e19eaa8f50be6234802b7f645ce886c294341c321f62e25c5222` |
| `/tmp/zhixing-dynamic-red.log` | `d68fb4d60a0814aea444bda990d628c97ba9b93686d1cfddbd7ace2e46b51ba5` |
| `/tmp/zhixing-dynamic-ci-root.log` | `9aa989adf4924b83b8811764523c20d01e9049a5f9e37863f596c58be8b1ac15` |
| `/tmp/zhixing-dynamic-ci-desktop.log` | `c2c842361e477e074d2b907217549db082390938c44afe7c22f436d16b943a22` |
| `/tmp/zhixing-dynamic-verify-release.log` | `f3b1311fdcd336f08ef87bab1072ac1b8e275fada87462ac0cb06f0b3bf9e5cc` |
| `/tmp/zhixing-dynamic-ui-final.log` | `6d168540c355318d751198830c14373033025fd278e4fe2ecd86b22c4e744c1b` |
| `/tmp/zhixing-dynamic-pack.log` | `533f1fa6c8602019414137496821050fcacdaac4e528afe16137587cb577565b` |
| `/tmp/zhixing-dynamic-pack-ui.log` | `a6102dbdbc98425e46867a4c02df06eb0e7540e4568c0d2f269e2a26c455f632` |
| `/tmp/zhixing-dynamic-audit-root.log` | `6d8c5c8f3d7684adb070417bd608d01ae90aa3dc26a65af03ffda4955f38d9a3` |
| `/tmp/zhixing-dynamic-audit-desktop.log` | `6d8c5c8f3d7684adb070417bd608d01ae90aa3dc26a65af03ffda4955f38d9a3` |
| `/tmp/zhixing-dynamic-installed-kimi.log` | `94ba660a6ebcae00ec1b43da7ec2d981fc8fcf97dd00b6860f149b490d66f171` |
