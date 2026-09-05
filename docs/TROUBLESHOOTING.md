<!-- generated-by: gsd-doc-writer -->
# 故障排查

先确定问题出现在 CLI 还是桌面：它们复用模型适配器，但数据目录和模型偏好独立。CLI 用 `模型状态`、`诊断` 查看本地配置；桌面用“设置”查看所选 Provider、Pi 模型偏好和 API 配置来源。“已配置”只说明找到了配置，不代表已经完成真实认证或连通测试。

## 安装、开发与质量检查

| 现象 | 处理 |
| --- | --- |
| Node 版本被拒绝，出现 `unsupported_node_version` | 源码开发及 CLI 要求 Node `24.8.x`。用 `node --version` 检查；切换到对应版本后，在仓库根目录执行 `npm ci`，再执行 `npm ci --prefix desktop`。已打包应用内附运行时，不要求另装 Node。 |
| CLI 报 `better-sqlite3` 原生模块或 ABI 错误 | 确认安装依赖与运行 CLI 使用的是同一 Node `24.8.x` 和当前机器架构，再在根目录重新 `npm ci`。不要把 Electron 架构的原生模块复制给 CLI；桌面独立使用 Electron ABI，执行 `npm --prefix desktop run prepare:runtime` 修复。 |
| 只安装根依赖后，桌面或 `npm run verify` 报 React/Electron 类型缺失 | 两个目录有各自的锁文件。补执行 `npm ci --prefix desktop`；根质量检查也包含桌面类型检查。 |
| GitHub Actions 在桌面类型检查失败，本机通过 | 当前 `.github/workflows/verify.yml` 只执行根目录 `npm ci`，随后 `npm run verify` 又检查桌面类型，存在未安装桌面依赖的配置缺口。不能将本机通过视为当前 CI 已覆盖；工作流需要补齐桌面依赖安装。 |
| npm 报 `Exit handler never called` | 仓库工作流因历史 npm 11 安装故障固定了 npm `10.9.2`。先记录 `node --version`、`npm --version` 与失败步骤，对照工作流和锁文件定位；不要通过忽略安装退出码继续构建。 |
| Electron 无法下载、缺少可执行文件 | 保留安装错误，确认网络/代理和当前平台。按[桌面 README](../desktop/README.md)完成 Electron 下载，再重新构建。需要镜像时保留官方 checksum 校验；已有 JS 依赖不代表 Electron 二进制已安装完整。 |
| 从源码启动后界面仍是旧版本 | `npm run desktop` 会先构建再启动；直接运行已有 `.app` 使用的是打包时的代码。源码更新后需重新构建/安装该应用才能更新已安装版本。 |
| macOS 打开提示应用未经验证 | 当前预览包没有 Developer ID 签名和公证。确认使用自己构建或已核实来源的预览包后，可按系统针对该应用提供的“仍要打开”流程处理；正式分发范围见[桌面说明](../desktop/README.md)。 |
| Intel Mac / Windows 无法运行已有 Mac 安装包 | 当前验收的是 macOS 13.0+、Apple Silicon 的 arm64 包。Windows 只有 NSIS 构建配置，需在 Windows 构建并验证；Intel Mac 尚未验收。不能用 Mac 的 Electron 二进制作为 Windows 构建运行时。 |

## 模型连接与选择

| 现象或提示 | 处理 |
| --- | --- |
| CLI 提示 tutor 为 mock，无法自然多轮辅导 | `mock` 是初始路由和本地演示。已配置 Pi 时执行 `模型切换 tutor pi-codex --确认`；已配置 DeepSeek 时选择 `deepseek-api`。已有资料查询和确定性学习命令仍可本地使用。 |
| 桌面只有固定演示回答 | 检查是否选择“离线演示”。它用于体验 UI，不调用模型；在设置中改选 Pi · Codex 或 DeepSeek API 后发送。 |
| “当前已禁用联网模型。可以在设置中切换到离线演示。” / `live_provider_disabled` | 启动进程继承了 `ZHIXING_ALLOW_LIVE_PROVIDER=0`。需要联网时在启动环境中移除此值并重启；需要本地演示时显式选择桌面 demo 或 CLI mock。该变量不会自动切换模型；本地 mock/demo 仍可用于离线流程。 |
| `external_content_confirmation_required: routed`，尤其是测试时的“学习建议” | `collectInvocation` 在解析实际 Provider 前检查材料授权，而总开关会令 CLI 的 `confirmed` 为 false。标准质量检查按 `npm run verify` 运行；测试自身负责 mock 和临时目录，不应再把整个检查进程统一设为 `ZHIXING_ALLOW_LIVE_PROVIDER=0` 并假定所有用例语义不变。 |
| Pi 显示“未找到 Pi 的 Codex 模型配置” / `pi_configuration_required` | 在 Pi 中设置 `defaultProvider=openai-codex` 及有效 `defaultModel`，再刷新桌面设置或重试 CLI。默认推理强度为 `medium`。字段要求见[配置说明](CONFIGURATION.md#pi-codex-接入)。 |
| CLI 能识别 Pi 模型，桌面不能 | 检查配置是否只存在仓库 `.pi/settings.json`。CLI 读取仓库级偏好，桌面读取应用数据 `runtime/.pi/settings.json`；通常应通过 Pi 的全局设置共享模型选择。另检查两种启动方式是否继承相同 `PI_CODING_AGENT_DIR`。 |
| “Pi 登录尚未完成” / `pi_login_required` | 在有系统 Pi 的开发环境通过 `./scripts/pi-safe.sh` 进入 Pi，执行 `/login`，选择 OpenAI Codex，完成后重试。不要把认证文件或 token 复制到知行；桌面目前没有内置登录向导。 |
| Pi 偏好已读取，仍无法回答 | 偏好检查只解析 Provider、模型、推理强度，不验证认证。已有[验证记录](evidence/desktop-app.md)也没有宣称 Pi 真实登录已恢复。可以在桌面点击失败回答下的“切换到 DeepSeek 重试”，或在 CLI 显式切换 tutor。 |
| `provider_model_mismatch` | Pi 返回的模型与本次解析的配置不一致，适配器会停止该轮。重新检查 Pi 偏好后发起新请求；不会静默换用其他 Codex 模型。 |
| “尚未配置 DeepSeek API Key，请在设置中添加。” | 桌面在设置中输入 Key；CLI 在 macOS 上执行 `模型添加 api-key deepseek-api`，按隐藏输入提示填写。仅切换 Provider 不会配置 Key。 |
| “DeepSeek API Key 无效或已过期” / HTTP 401 | 在设置中更新有效 Key。若桌面已有新加密 Key，它优先于旧 CLI Keychain 项；只修改旧 Keychain 项未必改变桌面实际使用的 Key。 |
| “DeepSeek API 账户余额不足” / HTTP 402 | 检查该 API 账号余额。应用不会代为充值或自动换账号。 |
| “DeepSeek API 暂时限流” / HTTP 429 | 稍后重试，避免连续重复提交；切换 Provider 是用户选择，不会自动发生。 |
| CLI `provider_unavailable` 或桌面通用“操作未完成” | 检查实际选择的 Provider、模型和网络。CLI 将部分网络/协议错误汇总显示，不会回传凭据或完整服务端错误；桌面只对部分明确错误码提供细分提示。 |
| Codex 没有及时输出 | 先区分 `pi-codex` 和 `codex-cli`，检查对应的安装、模型与登录状态。输出时机受实际 Provider 影响，不能把“已启动进程”当成已连通；Pi 配置识别也不是首字延迟测试。 |
| `provider_timeout`、回答只返回一部分或“等待回答超时” | CLI 两个 Codex 适配器上限为 150 秒，DeepSeek 为 60 秒；桌面总生成时限为 180 秒，但适配器的较短超时仍有效。保留部分内容，可点击重试/继续或输入追问；未完整结束的回答不算完成。 |
| 切换 Provider 后当前回答仍使用旧模型 | 已开始的调用固定 Provider 和模型；切换影响下一次发送。桌面失败消息保留实际 Provider 标记，“切换到 DeepSeek 重试”会在原会话发起新请求。 |
| “当前 tutor 适配器不支持知行工具调用” | `学习助手` 的多轮工具协议当前需要 `deepseek-api`。Pi Codex / Codex CLI 仍可纯文本问答；桌面 DeepSeek 在选定主题并勾选会话上下文授权后可用只读学习工具。 |

Pi 的 `--offline` 只约束启动时的更新等网络操作，仍允许模型请求；它与知行的禁止联网开关不是一回事。环境变量及凭据优先级见[配置文档](CONFIGURATION.md)。

## 桌面设置、凭据与历史

| 现象或提示 | 处理 |
| --- | --- |
| 重启后 Provider 仍是 DeepSeek | 这是已保存的 `preferences.json` 生效。应用首次默认值为 Pi Codex；已有用户选择优先。 |
| “API Key 格式不正确” | 桌面要求 Key 去掉首尾空白后为 8–4,096 字符，且不含空白字符。只在设置的隐藏输入框填写，不要粘贴到聊天或诊断记录。 |
| “暂时无法使用系统加密存储，请检查系统钥匙串权限后重试。” | 确认当前系统账户能够使用系统加密存储，按系统对该应用的权限提示处理；应用不会降级为明文存储。已有加密文件无法解密时也会报错，不会改用旧 Keychain 项。新 Key 的实际 OS 保存覆盖范围见[验证记录](evidence/desktop-app.md)。 |
| 桌面“已找到 API 配置”，仍连接失败 | 状态只检查文件存在或旧 Keychain 元数据。真实请求才会解密/读取并验证远端；根据随后返回的 401/402/429、超时或系统加密错误处理。 |
| “本地保存失败，请先复制当前回答，再检查磁盘空间。” | 先复制当前可见内容，检查空间与应用数据目录写权限，再重试。不要通过清空整个应用数据目录解决。 |
| 某个旧会话没有显示 | 桌面会跳过无法校验的会话文件但保留原文件。检查应用数据目录是否与之前相同；CLI 会话不会自动显示在桌面。排查前保留原文件及只读副本，不随意覆盖。 |
| “没有找到这段对话，请刷新会话列表。” | 刷新列表，确认仍使用原系统账户及数据目录。测试覆盖变量可能把应用指向临时目录；正式使用不要设置 `ZHIXING_DESKTOP_TEST_DATA`。 |
| 偏好文件损坏 / `settings_invalid` | 文件位于系统应用数据 `Zhixing/preferences.json`。保留原文件，对照[schema 与默认值](CONFIGURATION.md#桌面偏好与本地数据)检查 JSON；不要删除会话、凭据或整个数据目录。桌面可能只显示通用错误提示。 |
| “此会话已达到保存上限，请新建对话。” | 单会话最多 1,000 条消息。新建对话继续；原会话仍保留，可导出 Markdown。模型只接收受限历史，完整显示历史与模型记忆范围并不相同。 |
| “请先停止当前回答，再执行此操作。” | 桌面一次只允许一个生成任务。点击停止，等待保存结束后再发送；可以查看其他历史会话。 |

桌面数据目录为系统 `appData/Zhixing`，macOS 通常是 `~/Library/Application Support/Zhixing`。CLI 学习数据、同级 `learning-notes/` 与桌面 JSON 会话的用途不同；重装应用并不自动迁移或修复它们。

## CLI 学习、资料与同步

| 现象 | 处理 |
| --- | --- |
| 扫描 PDF 返回 `ocr_required` | 确认 `tesseract --version` 和 `pdftoppm -v` 可运行；否则保留原文件并改用文字 PDF/Markdown。OCR 仅在 CLI 资料库中提供。 |
| 没有检索结果 | 确认文件已导入当前 topic，并用 `资料库` 查看索引状态；检索默认主题隔离。可使用 `查询资料 <topicId> <问题>` 指定主题。 |
| 学习助手看得到资料目录，查不到正文 | 正文检索只在本次末尾加 `--允许外发` 时提供工具，不继承上一轮标志；未授权时不能仅靠模型提示获取正文。 |
| 重启后主题/计划和预期不同 | 检查 `--topic`、保存的当前主题及 `ZHIXING_ROOT`。该根目录默认是仓库父目录，CLI 会再追加 `zhixing/`；不要误设成仓库后又生成嵌套目录。自然计划草案只在当前进程有效。 |
| “还缺少学习画像” | 用 `设置学习画像 <目标> --水平 <基础> --每天 <15–480> --周期 <1–180>`，或继续补充待生成计划的信息。普通知识问答不要求先建画像。 |
| Review 未通过或无法进入下一天 | 按当前计划补齐实现、测试、失败案例、复盘证据。当前 `检查` 命令只接收证据声明标志，讲解完成或模型给出答案不会替代这些证据。 |
| 删除或恢复被拒绝 | 先执行对应预览核对影响，再使用带 `--确认` 的确切命令；恢复参数使用 `db/backups/` 中的 `.sqlite` 文件名。 |
| 同步服务不可访问 | 仅允许本机 `127.0.0.1`；使用启动命令返回的端口，保持该 CLI 进程运行，并检查端口占用。其他电脑或桌面应用不会自动连接。 |
| 数字开头主题的同步 URL 返回 404 | 核心主题 ID 允许数字开头，但当前 HTTP 路由仅接受字母开头；`3dgs` 等主题命中该已知缺口。可用 CLI 查看进度，无需删除或重建主题。 |
| SSE 收到了通知，但没有完整进度 | `progress` 事件载荷是 `topicId`、`command`、`at`，收到后再 GET 进度接口。主题范围在服务启动时固定，新建主题后需在后续重启的服务中访问。 |

若 `npm run verify` 失败，按[测试文档](TESTING.md)运行对应单项检查缩小范围。报告问题时附系统/架构、版本、CLI 或桌面、所选 Provider、复现步骤及脱敏错误；不要提供用户资料、数据库、Key、认证文件或审计原文。

## 新任务与产物

- 待办重启后未自动执行：这是恢复规则，点击“继续待办”；停止会暂停整个队列。
- 已勾选旧检查参数仍不能完成：布尔参数不再计入证据，使用“提交证据”或桌面产物面板。
- 测试结果消失：实现/测试脚本的哈希改变后旧结果不再对应当前产物，重新运行。
- 本地测试 unavailable：当前只有 macOS sandbox-exec 已验证；不会无约束执行。
- 长段落出处不对：新检索引用带 chunkId，可精确定位；旧对话引用仍按页码/锚点兼容读取。
- 原工作区会话不能继续：连接回对应工作区，或新建对话；不会跨工作区混合资料。
