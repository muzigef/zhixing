<!-- generated-by: gsd-doc-writer -->
# 图片输入

桌面支持选择、粘贴、拖入 PNG/JPEG，发送前显示预览并可移除。CLI 使用 `/image "完整图片路径" 问题`。两端共用 `ImageInput`、AgentService、会话持久化、上下文预算和 Provider 适配，不另建视觉聊天流程。

每次最多两张，每张最多 512,000 字节、长宽各 2048 像素；校验实际文件头和尺寸，不信任后缀或客户端 MIME。暂不支持 SVG、GIF、远程图片 URL 或 PDF 扫描页自动转换。附件属于当前会话，未发送图片在切换会话或退出时清除；发送被拒绝时保留供调整模型后重试。图片随消息发送到用户选定的模型。

DeepSeek 需选择 `deepseek-v4-flash-vision-exp`；普通 Flash/Pro 对新图片请求明确拒绝，不静默丢弃图片。模型名称与消息格式依据 [DeepSeek 官方视觉文档](https://api-docs.deepseek.com/guides/vision/)。Pi 在 SDK 中检查实际模型的 image 能力；其图片离线协议测试不能证明实际视觉任务已通过。Kimi 内置适配声明 text/image 并使用共享图片编码，但本轮没有新增 Kimi 真实视觉验收；自定义连接可显式声明 images，由所选三类 API 协议编码图片，仍须对实际模型单独验收。官方 Codex / Claude 当前拒绝图片，不静默丢弃。2026-09-11 三家最小文本连通检查不新增任何视觉质量结论。

会话 v8 及后续团队格式保留图片原文及元信息；升级旧格式时留存原文件备份。分支、编辑后重发、排队、任务检查点和 Markdown 导出保留图片。含图片的执行检查点为 v3，上限 4 MB。完整会话仍限 20,000 条、12 MB，因此大量图片会更早达到容量。

每轮最多送入最近四张图片，每张保守预留 2048 token；不把 base64 长度当作文本 token。较早图片省略时在模型上下文明确说明，要求需要时重新附图。后台摘要不读取图片像素，只记录存在附件，禁止据此编造图片内容；摘要来源哈希包含图片，附件更改使旧摘要失效。

真实合成检查：`node desktop/scripts/check-vision.mjs --live`。它通过应用安全存储使用已有 API，以画布生成的色块和数字作为已知答案，验证识别、UI 发送、重载、追问和导出。它不读取用户图片，也不证明所有图片任务都可靠。对应证据见 [0.9 验收记录](evidence/completion-0.9.md)。

实现与验证：[`ImageInput`](../src/image-input.ts)、[CLI 文件输入](../src/image-file.ts)、[能力声明](../src/model-capabilities.ts)及[图片契约测试](../tests/image-input.test.ts)。这些是接入和存储保证，不等于对视觉推理正确率的测量。
