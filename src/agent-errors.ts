export function publicError(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (code.startsWith("team_")) return ({ team_task_not_retryable: "仅可补做当前会话内尚未完成的团队任务，每项最多执行三次。", team_task_dependency_incomplete: "请先补做未完成的前置任务。", team_configuration_changed: "继续旧任务需要保留原团队配置；切换模式或主模型请发起新任务。", team_scope_changed: "团队任务的授权范围或配置已改变，请核对后发起新任务。", team_models_not_distinct: "异模型团队至少需要两个不同的实际模型，多个同模型连接不算不同模型。", team_member_provider_required: "请先为异模型团队的每个成员选择模型连接。", team_model_mismatch: "实际模型与团队保存的绑定不一致，请发起新任务。", team_model_binding_required: "当前通道无法固定实际模型，暂不能用于团队。", team_budget_exhausted: "团队已达到本轮共享模型预算，已保留成员结果。", team_tool_budget_exhausted: "团队已达到本轮共享工具调用上限。", team_study_unavailable: "教学效果试验需要固定原试验条件，请在普通会话使用团队。", team_member_not_active: "这个团队成员已结束或不属于当前任务。" } as Record<string, string>)[code] ?? "团队未完成，请检查模型连接和配置；已完成的成员结果会保留。";
  if (code === "provider_not_found") return "这个 API 连接已移除或尚未配置，请在设置中添加连接或选择其他模型。";
  if (code.startsWith("api_connections_")) return ({ api_connections_conflict: "连接配置已改变，请关闭设置并重新打开后再保存。", api_connections_key_required: "请先填写这个连接的 API Key。", api_connections_limit: "最多保存 20 个 API 连接，请先移除不再使用的连接。", api_connections_invalid: "API 连接配置无效或与原地址不一致，请重新添加连接。" } as Record<string, string>)[code] ?? "API 连接未保存，请检查地址和模型配置。";
  if (code === "image_model_required") return "当前模型不支持图片。DeepSeek 请在设置中选择 V4 Flash Vision；或选择支持图片的 Pi 模型。";
  if (code.startsWith("image_")) return "图片无法使用。请提供每张不超过 512KB、长宽不超过 2048 像素的 PNG 或 JPEG，每次最多两张。";
  if (error instanceof Error && error.name === "AbortError" || /^(?:import_)?cancelled$/.test(code)) return "已取消本次操作。";
  if (code.startsWith("mcp_")) return code === "mcp_settings_conflict" ? "外部工具配置已改变，请关闭面板并重新打开后核对。" : code === "mcp_cancelled" ? "已取消外部工具操作。" : "外部工具未完成。请检查连接、协议版本、工具权限和参数；服务日志不会显示在对话中。";
  const projectErrors: Record<string, string> = {
    project_selection_required: "请先在课程与资料中创建或选择实践项目，再开启项目授权。",
    project_patch_ambiguous: "待修改片段不存在或出现多次，请读取文件并提供唯一上下文。",
    project_patch_overlap: "修改片段互相重叠，请合并后重新提交。",
    project_path_collision: "文件路径重复、大小写冲突或与目录重叠，请核对完整文件列表。",
    project_snapshot_missing: "这个修改前快照已不在最近 20 次保留范围内，请刷新列表。",
    project_recovery_conflict: "项目恢复时发现了额外文件变化，已保留现场，未覆盖这些变化。",
    project_file_conflict: "文件已改变，请重新读取并核对差异后保存。", project_tree_conflict: "项目文件已改变，请刷新并重新运行测试。",
    project_tests_required: "需要当前项目的 .test.mjs 和 test_*.py 实际测试通过后才能保存检查点。", project_busy: "这个项目正在执行另一项操作，请稍后重试。",
    project_limit: "项目超出限制：最多 40 个文件、每文件 24KB、总计 256KB。", project_git_unavailable: "本地 Git 操作未完成。请确认 Git 已安装，稍后重试。",
    project_selection_changed: "当前连接的项目已改变，请重新选择并发起任务。",
  };
  if (code.startsWith("project_")) return projectErrors[code] ?? "实践项目操作未完成。请检查文件范围、项目状态与本地 Git；原导入目录未修改。";
  const learningErrors: Record<string, string> = {
    permission_scope_changed: "项目选择或外部工具配置已改变。请核对新范围，关闭对应授权开关后重新开启。",
    skill_version_mismatch: "技能内容已改变，请从第一页重新读取并核对版本。",
    task_revision_conflict: "任务计划已有新修订，请刷新后修改。旧计划已保留。",
    recovery_conflict: "这项操作的恢复状态已改变，请刷新任务详情。",
    recovery_verifier_unavailable: "该服务尚未配置只读结果核对规则。可以在服务中核对后记录自己的观察，或结束这项操作。",
    recovery_identity_missing: "原请求缺少服务核对所需的操作标识，无法自动核验。",
    recovery_identity_mismatch: "服务返回的操作标识与原请求不同，结果仍未确认。",
    recovery_still_unknown: "服务仍未给出明确结果，原操作保持待核对状态。",
    mcp_reconciliation_invalid: "核对规则必须使用已明确配置为可安全重放的只读工具。",
    observation_conflict: "学习记录已改变或达到修改上限，请刷新后核对。",
    observation_not_found: "找不到这条学习记录，请刷新列表。",
    outcome_review_conflict: "解释或复核记录已改变，请刷新后重新核对。",
    outcome_review_not_ready: "请在本次学习验证完成或结束后复核解释。",
    day_not_started: "请先开始这个学习日，再提交证据。",
    invalid_day: "课程中没有这个学习日。",
    evidence_size_limit: "请提交至少 8 个字符、最多 256 KB 的文本或代码。",
    evidence_file_type: "请选择文本、Markdown、日志或代码文件。",
    evidence_limit: "这个学习日已保存 100 份产物，请复用已有记录。",
    evidence_invalid: "证据内容缺失或已经改变，请重新提交。",
    test_artifacts_required: "请先提交 JavaScript 实现与 node:test 测试脚本。",
    release_unavailable: "暂时无法查询版本，请稍后重试。",
    release_invalid: "发布信息未通过校验，请前往项目 GitHub 页面查看。",
    storage_limit: "这段会话已达到本地文件保存上限，请新建对话。",
    workspace_mismatch: "这段对话属于另一个学习工作区，请连接原工作区后继续。",
    workspace_unavailable: "学习工作区暂不可用，请重新打开应用。",
    provider_modality_unsupported: "当前模型通道只接收文字，暂不支持图片输入。请粘贴需要讨论的文字。",
    context_budget_invalid: "上下文预算无效：需在应用和当前模型通道的限制内，并为回答保留足够空间。",
    workspace_invalid: "无法读取工作区设置，请重新选择学习工作区。",
    topic_change_requires_new_session: "切换学习主题时请新建对话。",
    topic_plan_invalid: "课程文件未通过校验，请检查课程格式；已有进度已保留。",
    citation_not_found: "这条引用的原文已不可用，请重新检索资料。",
    citation_version_mismatch: "原文内容与回答生成时不同，请重新检索后核对；历史回答没有自动改写。",
    cross_topic_denied: "无法在当前主题查看其他主题的资料。",
    file_too_large: "资料超过 250 MB，请选择较小的文件。",
    unsupported_mime: "目前支持 PDF 和 Markdown 资料。",
    learning_busy: "当前学习操作尚未完成，可以先取消。",
    no_active_task: "当前任务已结束，请直接发送这条消息。",
    provider_transport_invalid: "Pi 传输配置无效，请使用 sse 或 auto 后重新启动应用。",
    queue_full: "待发送消息已满，请先撤回或完成部分消息。",
    run_active: "当前任务尚未结束，可将新消息加入队列或立即调整。",
    provider_output_limit: "回答超出本轮输出上限，已保留现有内容。可以继续或缩小本轮范围。",
    execution_context_required: "原任务包含先前授权的资料、项目或外部工具记录。请恢复相同范围的授权，或新建任务。",
    session_in_use: "这段会话正在另一个入口运行，请先停止或等待当前任务。",
    repeated_tool_call: "当前状态下重复执行没有取得进展，任务已停止，请补充信息或调整要求。",
    execution_in_use: "这个任务正在其他入口执行，请等待或先停止原任务。",
    execution_scope_mismatch: "这个任务属于另一个会话或主题，无法在此继续。",
    execution_checkpoint_invalid: "任务检查点未通过校验，原记录已保留，请新建任务。",
    tool_recovery_required: "上次操作的结果不确定，无法安全自动重试，请先核对实际结果。",
    task_not_found: "无法恢复这个任务，请在原会话中继续。",
    interaction_resolved: "这个问题已经处理，请使用最新的待办卡片。",
    storage_version_unsupported: "这份数据来自更新版本，请先升级知行；原文件未修改。",
    backup_integrity_failed: "备份校验未通过，文件可能不完整或已改变。请重新导出。",
    backup_path_invalid: "备份路径无效。",
    backup_link_denied: "数据中包含符号链接，无法生成独立完整备份。",
    backup_destination_invalid: "请把备份保存到工作区和会话目录之外。",
    backup_size_limit: "备份超出 2 GB 或 20000 个文件的上限。",
    semantic_model_unavailable: "请先启动本机 Ollama 并安装所填的嵌入模型，再构建语义索引。普通关键词检索仍可使用。",
    semantic_model_changed: "本机嵌入模型在索引期间发生变化，请重新构建索引。旧数据已保留。",
    semantic_index_limit: "本次索引达到 5000 个片段的上限，已建立的索引已保留。",
    assessment_not_available: "这一天尚未配置独立知识检查；可以继续提交实验和复盘证据。",
    assessment_already_submitted: "这次检查已经提交，请开始一次新检查。",
    outcome_not_available: "这个主题暂未配置学习效果检查。当前支持 Agent 开发和 RAG。",
    outcome_not_found: "没有找到这次学习验证，请连接原工作区。",
    outcome_active: "这个主题已有进行中的验证，请继续或保留记录后结束本次验证。",
    outcome_stage_invalid: "这次验证已进入下一阶段，请刷新课程面板。学习对话在检查阶段暂停。",
    outcome_already_submitted: "这份作答已保存，不能修改为另一份结果。",
    outcome_review_not_due: "延迟复习尚未到期，请在学后检查满 3 天后回来。",
    outcome_session_mismatch: "学习对话与验证记录不匹配，请从课程面板进入原对话。",
    outcome_lesson_incomplete: "请先在本次学习对话中完成至少一轮回答，并处理或撤回待发送消息。",
    outcome_limit: "这个主题已保存 50 次验证记录，暂不再创建新记录。",
  };
  if (code === "platform_execution_unavailable") return "本机暂时没有可用的系统执行沙箱；请使用包含沙箱的 macOS 或 Windows 安装包，或继续使用对话与资料功能。";
  if (code === "mcp_isolation_unavailable") return "受限 MCP 当前需要 macOS 系统沙箱；本机可继续使用对话与资料功能。";
  if (learningErrors[code]) return learningErrors[code];
  if (code.includes("compatible-api 未配置")) return "尚未配置这个连接的 API Key，请在设置中管理该连接。";
  const compatibleHttp = /^provider_unavailable: compatible HTTP (\d{3})$/.exec(code)?.[1];
  if (compatibleHttp) return ({ "400": "接口拒绝了请求，请核对模型 ID、工具能力和兼容选项。", "401": "API Key 无效或已过期，请在设置中更新该连接。", "402": "API 账户余额不足，请检查服务商账户。", "403": "API 访问被拒绝，请核对 Key 权限和模型开通状态。", "404": "没有找到 API 接口或模型，请核对根地址和模型 ID。", "429": "API 暂时限流或配额不足，请检查账户或稍后重试。" } as Record<string, string>)[compatibleHttp] ?? `API 服务暂时不可用（HTTP ${compatibleHttp}），请稍后重试。`;
  if (code.includes("kimi-api 未配置")) return "尚未配置 Kimi API Key，请在设置中添加。";
  if (code.includes("kimi HTTP 401")) return "Kimi API Key 无效或已过期，请在设置中更新。";
  if (code.includes("kimi HTTP 402")) return "Kimi API 账户余额不足，请检查账户。";
  if (code.includes("kimi HTTP 403")) return "Kimi API 访问被拒绝，请检查 Key 权限及账户是否已充值开通 K3。";
  if (code.includes("kimi HTTP 429")) return "Kimi API 暂时限流，请稍后重试。";
  if (code.includes("deepseek-api 未配置"))
    return "尚未配置 DeepSeek API Key，请在设置中添加。";
  if (code.includes("deepseek HTTP 401"))
    return "DeepSeek API Key 无效或已过期，请在设置中更新。";
  if (code.includes("deepseek HTTP 402"))
    return "DeepSeek API 账户余额不足，请检查账户。";
  if (code.includes("deepseek HTTP 429"))
    return "DeepSeek API 暂时限流，请稍后重试。";
  if (code.includes("secret_store_unavailable"))
    return "暂时无法使用系统加密存储，请检查系统钥匙串权限后重试。";
  if (code.includes("invalid_api_key"))
    return "API Key 格式不正确，请重新填写。";
  if (code.includes("pi_login_required"))
    return "Pi 登录尚未完成。请在 Pi 中登录 OpenAI Codex，然后重试。";
  if (code.includes("pi_configuration_required"))
    return "未找到 Pi 的 Codex 模型配置。请在 Pi 中选择 OpenAI Codex 模型，再刷新设置。";
  if (code.includes("live_provider_disabled"))
    return "当前已禁用联网模型。可以在设置中切换到离线演示。";
  if (code.includes("provider_incomplete")) return "回答未完整返回，请重试。";
  if (code.includes("timeout")) return "等待回答超时，请重试。";
  if (code.includes("run_active")) return "请先停止当前回答，再执行此操作。";
  if (code.includes("session_segment_invalid")) return "历史分段缺失或校验失败，已停止读取以免使用不完整记录。原文件仍保留，可从完整备份恢复。";
  if (code.includes("storage_limit")) return "这段对话已达到本地容量限制。请先导出原文，并在新对话中继续。";
  if (code.includes("session_full"))
    return "此会话已达到保存上限，请新建对话。";
  if (code.includes("ENOENT")) return "没有找到这段对话，请刷新会话列表。";
  return "操作未完成。请重试；若是模型连接问题，请检查所选模型的配置和网络。";
}
