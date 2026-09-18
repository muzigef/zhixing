# 题库缺口开发证据

日期：2026-09-18。起点 `c373c03`，工作分支 `feat/interview-improvements-20260918`。范围与逐项状态见[台账](../interview-improvement-plan-20260918.md)。本记录持续追加，不表示全部条目已完成。

## I01：入口限制一致

CLI 使用共享 `MAX_INPUT_CHARACTERS`。新增 `tests/input-entrypoints.test.ts`，实际启动 CLI 并与桌面发送契约比较 8,001、20,000、20,001 字符；先复现三个失败，再验证接受/拒绝边界。`CI=1 npm run verify` 退出 0，162 文件、849 项测试。原始日志 `.build/interview-input-before.log`、`.build/interview-input-after.log`、`.build/interview-I01-verify.log`。

## I02：统一有界 HTTP 重试

三种 API 协议共用 `fetchModelResponse`，最多三次 HTTP 尝试，仅处理 429 和带有效 Retry-After 的 503。等待采用指数退避和随机扰动，尊重服务端最早重试时间；等待超过上限或剩余总期限时不提前重发。不重放网络结果不明、认证/参数错误、已经开始的流或解析失败；各次请求共用原截止时间与取消信号。遥测分别记录 HTTP 尝试数与等待毫秒数。

`tests/provider-retry.test.ts` 16 项覆盖三协议、单总期限、取消、Retry-After 秒数/日期、过长等待和用量不重复累计。`CI=1 npm run verify` 退出 0，163 文件、865 项。原始日志 `.build/interview-retry-before.log`、`.build/interview-retry-after.log`、`.build/interview-I02-verify.log`。没有新增服务商级分布式熔断器，也没有宣称重试能避免厂商所有收费。

政策依据：[RFC 9110 重试的幂等边界](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.2.2)、[RFC 6585 的 429 响应](https://www.rfc-editor.org/rfc/rfc6585.html#section-4)。

## I03：来源明确的记忆更正

数据库迁移 7 保留原记录，另存明确取代关系；更正前绑定记录 ID、主题和原文哈希。重复相同更正幂等，竞争更正/旧哈希拒绝，被取代记录不再召回，撤回新记录不复活旧事实。`search_memories` 返回原文哈希，`correct_memory` 先展示旧内容和新内容；普通会话写授权不能代替具体更正确认。CLI 管理命令为 `更正记忆 <id> <内容> --确认`。

定向 5 项覆盖持久化、冲突、权限、实际 AgentService 交互以及 CLI 子进程；另 8 项权限测试通过。首次全量为 869 通过、1 失败：备份测试仍断言迁移版本 6，现已修正为 7，重新执行完整门禁（164 文件、870 项）与桌面七组 UI 均退出 0，见 `.build/interview-I03-verify-fixed.log`、`.build/interview-I03-ui.log`。原失败日志 `.build/interview-I03-verify.log` 保留。以上机制不自动识别任意文本的事实矛盾，未建立明确更正关系时仍须核实。

## I04：摘要来源片段与忠实度评测

`conversationAnchors` 从用户消息的显式目标、约束、更正及待办中保留原文，排除代码围栏、引用行和助手声明；上限 12 项、6,000 字符，每项 700 字符，附消息 ID、行号、全文哈希、截断与省略计数。摘要提示和普通共享对话上下文都接入，原始消息不变。它不是通用事实抽取器，未标记的自然语言可能不被识别；来源一致也不证明用户陈述正确。

新增六组公开合成对话，覆盖条件否定、纠正、冲突、执行效果未知、引用注入和长消息中段。可运行：

```sh
npm run eval:quality -- --summary --repetitions=1 --output=.build/summary-fidelity.json
# 已授权真实连接时才显式附加 --live 与 --provider=deepseek-api 或 pi-codex。
npx tsx scripts/review-agent-quality.ts --report=.build/summary-fidelity.json
```

评测经真实 AgentService 后台整理，保存摘要、覆盖原文、哈希和评分标准；默认 demo 只验流程。输出保持 `pending_human_review`，通过哈希绑定的既有 `--reviews=...` 协议导入各项评分，不能将整理成功当成忠实度通过。受限教学试验仍使用其预先规定的上下文，未改实验条件。后台整理当前未记录独立调用延迟，评测不冒用前一回答的耗时或思考档位。

`tests/summary-fidelity.test.ts` 先复现来源片段缺失、评测参数被忽略，再验证修复；与覆盖、共享策略合计 16 项通过；完整门禁 165 文件、875 项及桌面七组 UI 均退出 0，日志 `.build/interview-I04-verify.log`、`.build/interview-I04-ui.log`。原日志 `.build/interview-summary-before.log`、`.build/interview-summary-cli-before.log`、`.build/interview-summary-cli-after.log`；首次类型检查发现测试使用高于项目目标的字符串 API，已改为既有 Unicode 编码检查，不提高编译目标。

## I05：长会话保存

仅复用已校验且文件 inode、大小、mtime/ctime 纳秒签名仍一致的片段，缓存上限 512 项且不缓存原文；目录与文件仍检查链接。签名变化后重新读、解析、校验哈希，缺段可从本次完整已验证快照重建，损坏段拒绝保存且不覆盖损坏证据。load 始终完整校验，不使用此缓存。save 去掉一次重复的全会话 schema 解析，仍先验证输入版本并捕获独立快照，仍遍历/序列化历史，不是固定成本。

运行 `npx tsx scripts/benchmark-conversation-save.ts`，每档两次预热、七次尾部修改，独立合成目录；记录墙钟、CPU、逻辑读写并校验重新启动后的完整原文。两轮同机无 UI/全量测试并发，[完整基线与优化记录](session-save-20260918.json)包含脚本及源码身份：

| 消息数 | 原保存 P50 ms | 优化后 P50 ms | 每次历史段读取：原→新 |
| --- | ---: | ---: | ---: |
| 250 | 1.70 | 1.52 | 0→0 |
| 2,000 | 12.11 | 5.65 | 7→0 |
| 10,000 | 59.59 | 25.76 | 39→0 |
| 20,000 | 116.13 | 56.41 | 79→0 |

逻辑写入字节未变；结果描述此 macOS arm64/Node 24.8 合成实验，不证明跨平台或 UI 渲染同幅度加速。定向 20 项覆盖缓存收益、同尺寸篡改、目录链接替换、删段重建、提交后可变对象修改、未来版本拒绝、旧格式与完整恢复；完整 verify（166 文件、879 项）与桌面七组 UI 退出 0，见 `.build/interview-I05-verify.log`、`.build/interview-I05-ui.log`。日志 `.build/interview-save-before.log`、`.build/interview-save-after.log`。

## I06：逐页 OCR 与覆盖声明

PDF 按页检测无文本页，仅对这些页补本地 OCR。原可提取文字不会被 OCR 覆盖，记录每页方法/置信度与未识别页；数据库迁移 8 持久保存覆盖信息。`ocr_partial` 表示部分页面未识别，可能是空白或识别失败，不冒充整份文档读取成功。可检索部分继续带覆盖/置信度信息进入生成提示，CLI 与桌面展示未识别页。

重试只处理剩余未识别页，保留此前成功 OCR 页；同一份资料不重复计算存储配额，片段、FTS、派生向量、页元数据与文档状态在同一事务替换。取消或写入异常保留上次可用状态。校验 OCR 页号、重复页号、置信度、页数与文本上限；总导入和 OCR 均有截止时间，不随逐页转换不断续期。按页转换后立即清理图片。

新增边界用例先复现混合页遗漏、重试配额重复计算、生成提示丢失 OCR 风险，以及重试丢失先前识别页，再验证修复。定向 47 项、类型与 lint 通过。首次完整门禁 885 通过、1 失败（CLI 备份预览仍断言版本 7），已同步版本 8 后复验：完整 verify（167 文件、886 项）与桌面七组 UI 均退出 0，日志 `.build/interview-I06-verify-fixed.log`、`.build/interview-I06-ui.log`。失败和定向日志保留在 `.build/interview-ocr-*.log`、`.build/interview-I06-verify.log`。

真实本机验收命令 `npx tsx scripts/verify-pdf-ocr.ts` 退出 0：生成公开英文内容，实际栅格化为 JPEG 后嵌入第二页；原生 Poppler 26.06.0 / Tesseract 5.5.2 识别第二页并完成导入，保留第一页面文字，识别结果 `CACHE CONDITIONS CAN FAIL`，耗时约 704 ms。[原始回执](pdf-ocr-native-20260918.json)。这是固定英文扫描页的工具链验收，不代表中文/公式/表格的识别准确率，也不是其他平台实测。

## I07：结构化切块与原文关联

Markdown 按代码/数学围栏之外的标题分节，无标题材料使用 root 锚点；有界表格、代码和数学块尽量保持完整，并与相邻短前提共同切块。仍以每块 1,000 字符为默认上限，逐字拼接还原原文，不插入或重复表头。超限结构记录最多两个实际来源块作为补充，检索前三条也能带出表头/前提，来源导航继续校验原文；关联查询同时限制主题与文档。PDF 文字保留解析器提供的换行，不宣称实现多栏版面理解。

数据库迁移 9 保存切块版本与原文关联。已有材料不会自动改写；显式重新导入时，旧版本索引在同一事务重建，新版本同内容仍去重。新规则不等于任意结构都能完整塞进上下文，长单行和超限块仍会分割；来源补充与全局预算均有上限。

`npx tsx scripts/benchmark-chunking.ts` 比较冻结的 c373c03 切块逻辑与新流程；五组公开开发探针的“前三条包含所需原文与正确锚点”从 1/5 到 5/5，具体为小表格、公式条件、长表格、代码内伪标题及无关查询控制。[原始对照](chunking-comparison-20260918.json)保留原文片段、数据集哈希和构建来源。这是定向回归结果，不是未见题、神经语义模型分数或最终回答正确率。

定向 20 项、类型与 lint 已通过；六项结构化测试包括真实导入、检索、工具输出、版本重建与原文导航，并补充关联越主题的拒绝。首次完整检查发现文档切块工具不应依赖会话上下文模块，以及误改了会话版本测试；移除跨层依赖并保留会话 v8、数据库 v9 后，完整 verify（168 文件、892 项）及桌面七组 UI 均退出 0，见 `.build/interview-I07-verify-fixed.log`、`.build/interview-I07-ui.log`。失败日志 `.build/interview-chunks-before.log`、`.build/interview-chunks-integration-before.log`，通过日志 `.build/interview-chunks-final-targeted.log`。

## I08：真实本地语义检索

新增 14 份公开合成手册、30 个问题（27 个有来源、3 个无相关资料）及标注；`npx tsx scripts/benchmark-retrieval.ts --output=新报告.json [--model=已安装本地模型]` 实际导入隔离工作区，记录逐题来源、内容哈希、数据集与代码身份。词法、纯语义和混合分别计数；失败、取消、模型不可用与词法回退不冒充成功。重复来源只计首次，相关文档＋锚点是召回分母，Precision@3 固定分母 3；无相关资料时单列误召回。

2026-09-18 实际运行 Ollama 0.33.3 / embeddinggemma，模型摘要 `85462619ee721b466c5927d109d4cb765861907d5417b9109caebc4e614679f1`，使用项目内临时运行时与模型目录；官方归档 SHA256 匹配，[发布来源](https://github.com/ollama/ollama/releases/tag/v0.33.3)。仅本机处理固定公开手册，未读取或上传用户资料、未全局安装。90/90 查询完成，无回退、不可用、失败或跨主题返回；三种方法对三个负例均未误召回。[逐题原始记录](retrieval-quality-20260918.json)。

| 检索方式 | Recall@3 | MRR | nDCG@3 |
| --- | ---: | ---: | ---: |
| 词法 | 0.6852 | 0.7037 | 0.6973 |
| embeddinggemma | 0.9259 | 0.9074 | 0.9123 |
| 混合 | 0.9630 | 0.8519 | 0.8809 |

混合召回更高但首条排序不及纯语义，不据此宣称全面优胜。样本为开发侧标注手册，不是独立未见题；负例仅三题，不能推断生产误召回率为零，也不证明生成正确性。运行时存在其他测试负载，耗时不作为受控性能结论。

定向 8 项、完整 verify（169 文件、897 项）退出 0，日志 `.build/interview-retrieval-final-targeted.log`、`.build/interview-I08-verify.log`、`.build/interview-retrieval-real.log`。本项为评测工具，没有独立桌面交互变更。

## I09：指标、关系、条件与误拦回归

证据规则改为按子句分别绑定指标和数字，增加分位数、增减方向、降幅/降至、显式前后数值顺序检查。数字来自假设、问题或未验证陈述时不能借用为实测；来源明确写“仅在……时/only when”却未在回答中保留的条件会要求修复。保留 source byte hash、原文定位以及原有一次修复机制，不新增无界模型调用。

修复了多指标正确答案被首个指标误伤、英文否定句/小数误判及同句另一个指标未测量导致的误拦；否定范围到转折/分句为止，不能用“不能证明”隐藏后续断言。新增八项边界用例先复现失败，再验证真实 grounded-answer 入口会阻止条件丢失。定向 21 项及完整 verify（170 文件、905 项）、桌面七组 UI 均退出 0：`.build/interview-support-final-targeted.log`、`.build/interview-I09-verify.log`、`.build/interview-I09-ui.log`。初始五类失败、追加前后值与小数用例失败分别保留于 `.build/interview-support-before.log`、`...-extra-before.log`、`...-decimal-before.log`。

这是可解释的有限规则，不能识别任意语义蕴含、隐含实验条件、任意同义改写或证明数学推导。显式条件的改写可能要求保留原条件措辞，属于已知保守边界；没有把开发用例通过率写成生产正确率。

## I10：分层 RAG 与实际误拦闭环

实现 `rag-evaluation`、八题公开标注资料与 `benchmark-rag`，分别记录检索、固定正确证据生成、真实检索后生成。生成器只接收题目和本阶段原文，不接收评分项；跨主题或文本/哈希不符时阻止端到端生成，固定组仍单独记录。题集哈希排除随机导入 UUID，原文改变仍改变身份。派发阶段与请求计数先落盘，持久化失败不请求模型；中断保留 running/已尝试，不冒充未尝试或自动重发。

完整报告与 `.quality.json` 可分别复核，两组评分绑定具体回答与来源。完成、引用和规则结果只作为观察，默认待评分；模型原始文本与最终被规则接受/拒绝的文本分开保存。脚本默认离线夹具，显式 `--provider=native-codex --live` 才调用官方订阅；可选本机混合检索失败不静默回退，仍有题数、请求数、输出和总时限。见[使用说明](../rag-evaluation.md)。

真实 Codex `gpt-6-astra`、quick、官方受限无工具运行时配合本机 embeddinggemma，先对 RAG01/RAG04 做两阶段四次生成：[原始首轮](rag-layered-before-20260918.json)。注入题两组回答正确；数值题被规则误拦。原轮未保留原始文本，因此另跑带原文轨迹的两次生成，确认模型给出了正确的 100→80 毫秒、20 毫秒差和 20% 降幅，且保留缓存命中条件：[定位轨迹](rag-layered-trace-20260918.json)。

真实回归反向补齐 I09：仅支持同指标/分位数、同单位、两个有来源端点的差值和百分比，不运行 eval、不宣称通用证明；拒绝零分母、单位混用、错误百分比/方向，圆整必须注明“约”。限定词可在分号后，或紧邻下一段以“该比较仅适用于……”且引用相同来源的形式出现；不同引用、泛化所有请求、或“不仅适用于”不能冒充条件保留。中间一轮仍存在下一段条件误拦，[该失败原样保留](rag-layered-partial-fix-20260918.json)。四份已保存正确原始回答在最后规则上回放均不再误拦；最后两次新模型调用也实际通过：[最终真实回执](rag-layered-accepted-20260918.json)。本项共 10 次真实生成，未使用用户资料。

开发侧逐项复核以 `development_assistant` / `independent=false` 导入：[首轮评分](rag-layered-before-20260918.review.json)、[最终评分](rag-layered-accepted-20260918.review.json)。同一道数值题用户可见回答由 0/2 满足全部三项到 2/2；注入题首轮为 2/2。不是独立盲评、总体正确率或学习收益；不能把不同轮的问题数混成总体提升。主报告保存代码/语料/检索条件，比较时必须一并核对。

最终定向 32 项、完整 verify（171 文件、916 项）及桌面七组 UI 均退出 0，日志 `.build/interview-rag-complete-targeted.log`、`.build/interview-I10-verify-accepted.log`、`.build/interview-I10-ui-accepted.log`。评测派发持久化先用旧行为复现失败，修复后通过；语料版本身份、取消、原文篡改和实际 CLI 导出/评分入口均受回归覆盖。所有中间失败与首次门禁记录保留。实际模型命令日志 `.build/interview-rag-native*.log`，评分 CLI 两份导入均退出 0。

验收后已停止本任务启动的 Ollama 进程并确认 11434 端点关闭；只保留项目 `.build/semantic-runtime` 下的公开运行时和模型缓存，未全局安装或修改用户资料。

## I11：团队任务包与分阶段诊断

团队共享沿用 I04 的显式原文锚点策略，从已授权的原对话保留目标、约束、纠正、未完成事项；排除 system、助手声明、引用块和代码围栏。关闭共享时不生成历史或锚点元数据。十二条历史与最多十二个原文锚点共同受 24,000 字符上限约束，长消息保留首尾和 Unicode，记录源哈希与历史投影省略量。契约拆为纯数据模块，保持 CLI/桌面适配器不自行引入上下文政策。

规划、独立成员、定向复核、再审与最终综合都传递同一授权原文锚点。新冻结任务包带来源元数据；历史包兼容，载入也校验总预算，恢复前校验包哈希及共享政策，不等到模型开始后才发现任务内容改变。未标记内容仍可能被截断，锚点自身也有数量与长度界限，省略显式保留；原文声明不授予权限或证明事实。

团队评测行新增 `diagnostics`，顶层 `stageDiagnosticsVersion=1`。按 planning/member/review/followup/answer 记录完成、格式问题、请求耗时和已知用量，未知用量单列；追加复核与其后的再审计入纠错成本，记录命题值是否改变及验收覆盖。请求耗时总和含并发，不称为墙钟延迟；命题变化、未决事项减少或格式有效均不等于变正确。阶段原始任务、报告和实际回执继续保留在 turns，语义评分标为 requires_review，后续 I13/I14 负责独立维度与评阅链路。

先复现早期约束丢失、长消息头部丢失、冻结包篡改未拒绝，再补载入总量越界和恢复前无模型调用的回归；实际 TeamCoordinator 贯穿各阶段验证原用户消息 ID 与约束保留，evaluateTeams 真实调度测试验证阶段统计出现在报告。定向 50 项、完整 verify（173 文件、925 项）、桌面七组 UI 均退出 0，日志 `.build/interview-team-complete-targeted.log`、`.build/interview-I11-verify.log`、`.build/interview-I11-ui.log`。本项阶段模型为合成协议夹具，真实团队质量对照在 I12 单列，不宣称本项已证明准确率提升。

## 验收范围

所有测试仅使用隔离的合成工作区。上述 HTTP 为协议夹具，不能作为真实账号连通性或模型质量提升的证据。未读取用户凭据，未改动已安装应用；跨平台实包、独立评阅、真实学习者和正式签名按后续条目分别验收。

## I12：扩充四组开发对照（工程通过，真实运行另记）

- 新增 X01–X12 公开开发题，未修改历史 D/H/Q；事务、相关错误、概率预测误差等关键 oracle 以实际 SQLite/枚举/独立计算核对。X11 明确使用“Brier 更低”，不将其混同总体校准。
- 同题同次配对、题内平均、按题 2000 次重采样、探索性双侧符号检验；缺失配对单列，未完成交付分计零，重复不增加题数。仅 1 题时区间为空。
- 共享 suite/case/repetition schema；无效选择在模型绑定前拒绝。版本 7 保存全题集和所选题哈希、实际请求状态及四组配对统计。
- 实包评测强制隔离工作区，产品安全存储只读，禁止设置/凭据修改和普通聊天/工具入口。使用已有固定签名证书；不新建证书、不替换已安装 App。
- 定向 16 项通过；完整 verify 176 文件 934 项通过（以日志为准），七组 UI 通过。日志 `.build/interview-I12-targeted.log`、`interview-I12-verify.log`、`interview-I12-ui.log`；缺模块的红灯日志保留。
- 运行说明：`docs/team-evaluation-expanded.md`。真实模型与独立解释评分尚不能由上述合成测试替代，后续回执分别记录。

### I12 真实构建与连接补记

固定本地证书打包成功，签名已验证，不是正式公证。当前构建隔离启动及配置检测通过；两次 DeepSeek 预检分别 1729 ms / 13093 ms 完成，两次 Kimi 均在 60 秒连接预检期限内未完成。因此 48 行质量实验 **0 行开始**，不能给出四组质量分数或说成质量提升。失败回执 `team-expanded-preflight-20260918.json`、`team-evaluation-failed-20260918042556423.json`。期间出现系统安全代理进程，是否有待授权窗口尚待用户确认；不能仅靠超时断言余额或网络故障。

退出时隔离应用未响应正常关闭/SIGTERM，最终只终止本次隔离进程；没有终止已安装应用或全局 SecurityAgent。评测脚本增加失败回执与 10/15 秒关闭兜底；未修改模型超时来掩盖失败，不自动进行第三次付费重试。

## I13：解释正确性、完整性、清晰度

- 冻结 explanation-v1 的三个 0–4 分维度，各需独立理由和真实回答摘录；返回 criteriaVerdict 与综合 verdict，核心推理错误不能被格式或可读性抵消。
- v2 review 强制三维齐全，绑定报告哈希；旧 v1 保留维度未评分。通过统计不自动将长解释算语义通过，评分者独立性仍为声明。
- 团队版本 7 可导出 final/member-1/member-2/review/followup，保存阶段输入、任务范围和来源报告哈希；缺失四组结果保留分母。CLI 真实进程验证导出、摘要和禁止覆盖旧证据。
- 定向 12 项；完整 verify 178 文件 939 项通过。首轮 lint 未使用测试变量失败已修复；日志 `interview-I13-targeted.log`、`interview-I13-verify.log`、`interview-I13-verify-fixed.log`。未改变桌面交互，七组 UI 为 I12 当次结果，没有冒报 I13 重跑。
- 文档 `docs/explanation-quality-review.md`。尚无新独立人工评分，不据此宣称真实教学质量改善。

## I14：盲评接收、校准和一致性

- 新增 Agent 盲评匿名包与独立负责人映射；逐项核验报告/包/原文/标准/映射，再转为 v2 评分；原文可能自报身份，不能保证匿名。RAG 证据与摘要源文本随必要上下文保留，模型/分组/已有自动分数不随包发出。
- 双评阅者逐维配对：精确/差一分内一致率、绝对差、方向差、二次加权 Cohen kappa；常数或缺失数据返回空值，按模型组检查方向偏差。自报模型猜测另计，不推断身份可信。
- 校准命令与同一报告上的指定参考评分比较，不自动认证评阅者，也不把开发者参考说成专家共识。
- 学习者闭合答卷可批量导入多个评分，原文/修订核对后追加历史；生成新导出文件，原导出与实时数据库不修改。CLI 真正执行 create/import/compare/calibrate 与学习者导入，验证不可覆盖及受限路径拒绝。
- 初轮定向 21 项，补充 RAG 证据后定向 9 项；最终完整 verify 180 文件 946 项通过，桌面七组 UI 通过。日志 `interview-I14-targeted.log`、`interview-I14-targeted-final.log`、`interview-I14-verify-final.log`、`interview-I14-ui.log`。红灯记录保留，包含 RAG text/content 字段差异，已修复。
- 文档 `docs/blind-review-workflow.md`；没有新增真实评阅者或真实人评结果。

## I15：冻结标准、曝光记录和比较条件

- 可冻结完整评测设计；单因素/消融只允许声明的一个因素变化，多因素必须声明 system。核对运行时间、数据集、rubric、十项条件和缺失组，失败输出独立回执并返回非零。
- 每题显式曝光状态与后续事件；运行间曝光会使整体失去未见资格，运行后曝光保留给后续使用。声明不等于第三方认证，公开 D/H/Q/X 不能因旧命名重新成为未见题。
- 普通质量入口先 checkpoint 再派发；冻结题目副本，run 的参数修改/返回 criteria 不改变评分标准。RAG 首题前冻结全题 rubric，partial checkpoints 保持一致；quality sidecar 带完整来源条件，旧历史回执不重写。
- rubric 哈希包含维度定义和逐题要求；团队阶段维度评分明确 export_time，不能倒称预注册。
- 定向 21 项；完整 verify 181 文件 953 项通过。日志 `interview-I15-targeted.log`、`interview-I15-verify.log`；单因素/时序曝光、rubric 未预保存等红灯记录保留。CLI 实际冻结、核验和禁止覆盖均通过。
- 文档 `docs/evaluation-design.md`；未新增真实未见题或实际独立消融质量结果。

## I16：客户端冷热与真实计时

- 共享有界基准：1–3 周期，每周期 fresh_client / reused_client 配对，固定公开短提示，无历史或工具；每次 60 秒、1000 可见字符，API 2048 输出 tokens；原生 token 仍非硬限制。保存失败会停止后续派发。
- 分开首事件、首非空白正文、准备和总耗时，原生按完整消息注明；共享 AgentService 保留空白但不提前记首正文。失败/取消/未尝试和未知用量单列，耗时分位数仅用已完成样本。
- 修复桌面诊断漏掉官方运行时、未知缓存记零的问题；新增严格有界性能 IPC，UI 实际经官方执行器夹具验证新建/复用路径。
- 定向 13 项，完整 verify 183 文件 960 项、七组 UI 通过。日志 `interview-I16-targeted.log`、`interview-I16-verify-fixed.log`、`interview-I16-ui.log`。首轮 lint 的无 yield 测试夹具已修复，红灯及单次 checkpoint 故障回归保留。
- 真实官方 Codex / gpt-6-astra / quick，代理 15236，固定短问题 4/4 完成。准备 57.5–80.9 ms；首完整正文 6.02–8.20 秒，总耗时 9.81–15.80 秒。两组各两例，按最近秩新建 P50 10.66 秒、复用 P50 9.81 秒；第一对复用更快、第二对更慢，不证明稳定提速或远端缓存命中。正文出现后的 3.64–7.60 秒仍属于整个官方任务，不能直接归因为本机收尾。
- 真实回执 `provider-performance-native-20260918.json`（含完整源码快照/已知 token 用量）；四次均不保存实际正文，只保存哈希。源码哈希 44a9b67b454a8bf7deee9e0dd6548d10e330ba3e168d29b6ff541efeeb6c0b2c。
- 文档 `docs/provider-performance.md`；API 性能入口已实现，未把此前 DeepSeek 单次预检或 Kimi 超时当成冷/热质量对照。桌面新性能入口以 UI/IPC 夹具验收，本次真实性能使用当前源码的官方 NativeAgentExecutor；没有宣称新安装了 App。

## I17：迁移、保持和真实教学材料就绪

- 三阶段迁移单独作答，问题/原文纳入评分哈希；旧评分哈希兼容，不补造旧迁移结果。解释与迁移分别复核，独立性默认未声明，开发助手不得声明独立人评。盲评导入保留这些字段并追加历史。
- 材料门禁检查三阶段、两位声明独立人评、实际 72 小时、构建/模型条件、学习时长、迁移与来源完整性。负面评分与分歧保留，不用好结果筛选。身份/真实研究/因果效果仍未认证；偏离不自动从后续意向性分母删除。
- 21 项定向；完整 verify 184 文件 965 项及七组 UI 通过。实际桌面测试覆盖迁移必填、重启/导出、独立性默认关闭及单独迁移判断；共享服务测试确认迁移答卷不进入教学上下文。日志 `interview-I17-targeted.log`、`interview-I17-verify.log`、`interview-I17-ui.log`。
- 文档 `docs/teaching-readiness.md`。仅隔离合成答卷/注入时钟，不冒充真实学习者或修改系统时间。

## I18：随机分组、预设指标与意向性统计

- 冻结封闭参与者代号名单、样本依据、构建/模型/时长、72 小时延迟答对数和缺失规则，一次用密码学随机源独立等概率分配两组；不保证小样本人数相等。个人票据不含其他代号。文件禁止覆盖，哈希不认证身份/分配隐藏/未重抽。
- 桌面导入调用共享入组方法，固定组别/trial ID/时间，重试幂等；拒绝已有同主题暴露的工作区。个人自选记录保持原义，导出明确分配类型，核对时拒绝改组或未分配答卷。
- 全体分配者纳入意向性分母，未开始/中止/帮助/改变条件不静默排除；预设延迟未测或提前测量保持缺失，保留原始结果。输出组内失访、失访差、0–3 分最差/最好界，非置信区间；只有预先选择才填零，合规完成者单列敏感性描述。
- 14 项定向；完整 verify 185 文件 970 项及七组 UI 通过。CLI 实际创建/出票/汇总/覆盖拒绝，桌面实际导入/幂等与跨主题拒绝。首轮 TypeScript 的 UUID 默认参数窄类型已修复；日志 `interview-I18-targeted.log`、`interview-I18-verify.log`、`interview-I18-verify-fixed.log`、`interview-I18-ui.log`。
- 文档 `docs/teaching-study-design.md`。测试均为合成代号/答卷，没有实际招募或学习效力结论。

## I19：原生安全存储和跨平台检查入口

- 统一平台 cipher：macOS/Windows 继续异步 Keychain/DPAPI；Linux 只在可观察的同步 GNOME/KWallet 后端可用时启用，拒绝 basic_text、unknown、未知未来后端和不可用服务。不会以同步后端名称替异步回退作安全保证。每次加解密再检查，错误不输出系统细节。
- 新增隔离原生探针：公开合成值写入、跨进程重启解密、密文无原文、畸形密文拒绝；不读取真实密钥/旧钥匙串，不访问模型。回执带实际 OS/架构、Electron、实包标识与二进制/构建哈希。超时保留失败并清理本次进程。三 OS CI 与发布实包门禁已接入，尚未在远端运行。
- 10 项定向，完整 verify 186 文件 973 项、七组 UI 通过；两份 workflow YAML 解析和探针脚本语法检查通过。日志 `interview-I19-targeted-final.log`、`interview-I19-verify.log`、`interview-I19-ui.log`。
- 当前 Mac arm64 实包使用已有固定签名，未新建证书、未安装替换应用、未公证。真实原生探针 create 阶段 45 秒未完成初始化，退出后仅终止本次隔离子进程；未进入 restart 验收。失败回执 `native-secure-store-macos-20260918.json`，日志 `interview-I19-native.log`；无法据此断言具体为系统授权或后端故障。不得称本机原生加密验收已通过。
- 文档 `docs/native-secure-storage.md`。Linux 有条件支持不代表新增了 Linux 发行包，KWallet 规则夹具不代表各桌面真实运行；Windows/Linux 原生回执仍待目标 OS CI。

## I20：预览/正式发行与精确产物门禁

- 版本标签强制 formal，手动默认 preview。Mac 必须 Developer ID、hardened runtime、公证与 Gatekeeper；Windows 必须安装器/已安装程序 Authenticode 有效、时间戳且同一签署者。正式凭据缺失即失败，不新建证书或退回本地签名。
- 实际读取 Mach-O/PE 架构、ASAR 内版本、构建与资源哈希；七组实包 UI 和原生存储回执必须绑定同一包。Mac ZIP 不解压而流式核对完整应用文件/链接清单，DMG 只读挂载比对；Windows 核对实际 NSIS 安装回执和核心文件哈希。卸载失败不删除仍挂载目录。
- 三个平台 formal 回执、同一源码哈希和五个下载后产物哈希齐全后才创建发行草稿。CI 固定源码换行，失败回执单独上传。@electron/asar 3.4.1 从已安装间接开发依赖明确列为直接开发依赖，锁文件仅新增这一行，无生产依赖变更。
- 21 项定向、完整 verify 187 文件 980 项通过；实际固定签名 Mac 包的七组 UI 全部通过，回执 `packaged-ui-macos-20260918.json`（构建 edcdd78fac1e1f52d77be91977eee83da01473d0ac7f89c69eb53baf30496bb2）。包是 I19 所构建，没有替换已安装应用。JS/Python 脚本与 workflow 语法通过，CLI 实际核对完整/缺平台/改动上传字节和 ZIP 越界/缺失/变更。
- 正式检查真实退出非零，原因包含原生存储未通过、无对应发行产物、缺 Developer ID/hardened runtime/公证/Gatekeeper；回执 `formal-release-gate-macos-20260918.json`。这是正确拒绝的实测，不是正式发行成功。
- 日志 `interview-I20-targeted-cli.log`、`interview-I20-payload-targeted.log`、`interview-I20-verify.log`（JS 测试 Node 全局导入失败已修复）、`interview-I20-verify-final.log`、`interview-I20-packaged-ui.log`、`interview-I20-formal-gate.log`；文档 `docs/formal-release-gate.md`。目标 OS 与正式账号/证书的真实发行仍待外部条件。

## B01：能力声明与实测证据分开

- 文本探针和最多两轮合成工具往返分别核验；无业务工具、无资料外发。模型身份仅取服务端实际响应，配置值不冒充返回值；未报告、工具未确认、图像/上下文窗口未测保持明确。
- 三种真实协议适配器经过本地 HTTP 夹具；桌面测试覆盖工具按钮到 IPC。原生 help/version 探针不访问认证，实际 Codex 0.153.4 兼容性通过，回执 `native-runtime-codex-20260918.json`。这些不代表各厂商真实工具调用已验收。
- 定向 71 项、完整 verify 189 文件 989 项及七组 UI 通过。日志 `interview-B01-targeted.log`、`interview-B01-verify-fixed.log`、`interview-B01-ui.log`；旧失败保留。说明 `docs/provider-capability-evidence.md`。

## B02：逐请求预算与估算边界

- 修复已报告/未知混合输入取最大值而低估的缺陷；新账目持久记录各请求预留与实际回执，恢复核对汇总。旧记录未知部分保守保留全部估计。测得的比例及正开销校准后续预留，不宣称首次调用或费用硬上限。
- API 汇总 usage 延后至正常终止结算并向上层发送，重复/非整数拒绝且不释放；异常结束但有效单份 usage 仍记实际消耗。原生任务保持观察性质，界面“至多”改“目标”。
- 定向 29 项、完整 verify 190 文件 995 项、桌面七组 UI 通过。日志 `interview-B02-targeted.log`、`interview-B02-verify-final.log`、`interview-B02-ui.log`；两个测试夹具 lint/类型错误及修复日志保留。说明 `docs/team-budget-accounting.md`。

## B03：派生产物依赖与异步来源复核

- 摘要绑定规则、原文范围和摘要哈希，记录生成配置身份；失配停止注入旧文本、保留原文重建。文档索引组合提取/切块 recipe，显式重导入不复用旧规则 OCR。语义向量键包含处理规则、文档规则及模型身份，异步构建/查询返回后再查来源，变更拒绝旧结果。源码身份忽略 Python 生成缓存。
- 28 项定向及 CLI 29 项、完整 verify 191 文件 1001 项、七组 UI 通过。全量初次失败是六个 CLI/桌面一致性夹具要求发送未验证旧摘要，已同步新失效语义并重新验证。日志 `interview-B03-before.log`、`interview-B03-ocr-before.log`、`interview-B03-targeted-final.log`、`interview-B03-cli.log`、`interview-B03-verify-fixed.log`、`interview-B03-ui.log`。
- 说明 `docs/derived-artifact-dependencies.md`。规则版本不冒充外部 OCR 二进制证明；服务端同名模型内部变更不可见时仍保持限制。旧向量/摘要保留，不自动修改用户源资料。

## B04：外部幂等约定与恢复绑定

- 修复 isError 查询仍可能被采信的问题；核验需有界身份、结构化状态和可选原请求哈希一致。配置可声明 string 操作键，宿主按主题/任务/持久调用/工具绑定生成；两种 MCP 加载入口共用，模型不能提供或替换该键。恢复重建同一线载荷身份。
- 不自动重放未知写入，幂等键不自动获得 replaySafe；人工自报仍未验证。仅有旧配置字段身份的核验单列 identityBasis，没有请求摘要契约时不声称载荷核验。
- 定向 31 项、完整 verify 192 文件 1007 项、七组 UI 通过。本地真实 MCP 子进程写入后退出，确认只写一次，恢复仅状态查询；错误回报与错载荷仍保持未知。日志 `interview-B04-before.log`、`interview-B04-contract-before.log`、`interview-B04-targeted.log`、`interview-B04-verify.log`、`interview-B04-ui.log`。
- 说明 `docs/external-operation-recovery.md`。并未连接真实外部业务服务；服务是否兑现去重及身份协议仍需具体服务验收。

## B05：显式外部资源版本

- 只读/replaySafe 工具可配置请求身份、响应身份和版本字段。宿主独立产生绑定资源的哈希回执，随结果与执行前状态持久化；循环状态按本次参数对应资源筛选，其他对象、返回正文和未配置字段不能解锁。
- 实际 AgentService 和本地 MCP 子进程验证：初次观测建立状态，同版本后续重复停止；通过另一个查询观测新版本后可重读。普通文本、isError、身份错配和无效版本不产生进展；JSON 重载保持版本，不放宽轮数/时间/预算。
- 定向 26 项、完整 verify 193 文件 1011 项、七组 UI 通过。初轮测试将已有循环终止状态误写 blocked，改为既有 failed 并同时断言明确防循环原因。日志 `interview-B05-before.log`、`interview-B05-targeted-final.log`、`interview-B05-verify.log`、`interview-B05-ui.log`。说明 `docs/external-resource-observations.md`。
- 服务版本仍是服务声明，不等于外部事件订阅或事实认证；未真正查询时无法知道别人是否修改。

## B06：跨存储故障矩阵及防降级

- 数据库恢复不再先删除目标 WAL/SHM；目标日志存在即拒绝。先校验唯一暂存副本的 schema/quick_check 和已确认 SHA256，再检查目标未变化后原子替换；失败仅清理自己的临时文件。快照校验运行于私有副本，避免 SQLite 只读连接向原备份旁创建日志或读取未绑定日志。
- 完整备份在 manifest 完成后仍检查取消，取消不发布成功；工作区恢复在会话发布和结束阶段检查，部分副本保留撤权及未完成标记，原数据/备份不删。含 budgetLedger/summaryRecipe 的会话升级 v14，拒绝旧格式覆盖并保留升级前副本。
- 新增 11 项实际故障注入：文件替换失败、损坏/错换暂存、未来 schema/链接、日志保护、只读检查无旁写、预算结算落盘失败后重载与二次消费拒绝、SQLite checkpoint/event 原子回滚、备份/恢复末尾取消。包含既有真实 SIGKILL 和恢复回归后定向 38 项通过；版本专项 24 项通过。
- 最终完整 verify **194 文件 / 1022 项**，另重跑 integration 9 项、eval 6 项和 mock smoke（已包含于全量，不重复相加），lint、两端类型、敏感扫描、diff 检查通过；桌面七组 UI 通过。日志 `interview-B06-targeted-final.log`、`interview-B06-version.log`、`interview-B06-verify-final.log`、`interview-B06-ui.log`。
- 初轮故障夹具漏填 schema applied_at 已修正；真实红测保留。第一次修复发现 SQLite 只读旁写，再改私有副本；全量发现三处旧版本断言，更新到 v14 并补 ledger 存在断言后重跑通过。失败日志均保留，不移除失败分母或绕过门禁。
- 说明 `docs/recovery-fault-matrix.md`。这些测试覆盖进程崩溃/取消及受控 I/O 失败，不宣称跨存储全局事务、任意外部并发数据库替换安全或突然断电硬件持久性。

## 最终边界

26 项工程改动已落实。Kimi 扩展对照仍是预检失败、0/48 行开始；本机原生存储初始化超时、Windows/Linux 原生存储流程未远端运行；独立人评、实际学习者与 72 小时随访未开展；正式发行条件未齐。I19 包的实包 UI 是该哈希的历史验收，不是 B 项最终源码重新打包。本验收记录生成时，代码尚未提交/推送，安装 App 未改变。最终门禁与源码身份见 [机器可读回执](interview-improvements-acceptance-20260918.json)。
