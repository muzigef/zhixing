# 快速开始

## 前置条件

- Node.js `24.8.x`（项目会在启动时校验）。
- npm；仓库含 `package-lock.json`，优先使用 `npm ci`。
- 可选：`tesseract` 和 `pdftoppm`，仅扫描 PDF 的本地 OCR 需要。

## 安装与验证

```bash
npm ci
npm run verify
npm run start -- '主题列表'
```

`verify` 依次运行 lint、typecheck、单元测试、integration、eval 和 mock smoke。

## 最小学习流程

```bash
npm run start -- '学习 rag'
npm run start -- '开始第 1 天' --topic rag
npm run start -- '进度' --topic rag
```

交互模式使用 `npm run repl`。执行一次 `学习 <主题>` 后，当前主题会保存在本机设置中，之后进入 REPL 会自动恢复；命令行参数中的 `--topic <topicId>` 必须在业务命令之后。

若 `tutor` 路由为 DeepSeek 或 Codex，可在 REPL 直接说“创建 3DGS 的学习计划”。回答它依次提出的必要问题后，回复“直接运行”即可一次完成画像保存、定制课程生成和启用；接着输入“开始第 1 天”会得到教师讲解与诊断问题。`mock` 路由仍只提供确定性的学习卡。

## 个性化学习流程（无需模型）

```bash
npm run start -- '设置学习画像 掌握 RAG 面试 --水平 初学 --每天 45 --周期 14' --topic rag
npm run start -- '生成个性化计划' --topic rag
# 查看输出的版本号后：
npm run start -- '启用个性化计划 personal-plan-<version>' --topic rag
npm run start -- '生成技能草案 rag-interview' --topic rag
npm run start -- '读取技能草案 rag-interview' --topic rag
npm run start -- '启用技能草案 rag-interview' --topic rag
npm run start -- '学习建议' --topic rag
```

画像、计划、资料概览与 Skill 草案均只保存在当前主题。`学习建议` 使用当前 `tutor` 路由且仅发送画像与资料名称；设置 `ZHIXING_ALLOW_LIVE_PROVIDER=0` 会禁止真实 Provider 调用：允许 fallback 的路径可使用 mock，教学和自然交互会显示禁用错误。`--允许外发` 只是兼容语法。

## 导入与查询资料

将文件放在 `inbox/<topicId>/`，例如 `inbox/rag/notes.md`，再执行：

```bash
npm run start -- '导入资料 rag/notes.md'
npm run start -- '查询资料 rag 检索如何提供引用'
```

资料默认只在本机处理。详见 [配置](CONFIGURATION.md) 与 [CLI 参考](CLI-REFERENCE.md)。
