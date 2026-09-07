export function publicError(error: unknown): string {
  const code = error instanceof Error ? error.message : "";
  if (error instanceof Error && error.name === "AbortError" || /^(?:import_)?cancelled$/.test(code)) return "已取消本次操作。";
  const learningErrors: Record<string, string> = {
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
    workspace_invalid: "无法读取工作区设置，请重新选择学习工作区。",
    topic_change_requires_new_session: "切换学习主题时请新建对话。",
    topic_plan_invalid: "课程文件未通过校验，请检查课程格式；已有进度已保留。",
    citation_not_found: "这条引用的原文已不可用，请重新检索资料。",
    cross_topic_denied: "无法在当前主题查看其他主题的资料。",
    file_too_large: "资料超过 250 MB，请选择较小的文件。",
    unsupported_mime: "目前支持 PDF 和 Markdown 资料。",
    learning_busy: "当前学习操作尚未完成，可以先取消。",
    no_active_task: "当前任务已结束，请直接发送这条消息。",
    provider_transport_invalid: "Pi 传输配置无效，请使用 sse 或 auto 后重新启动应用。",
    queue_full: "待发送消息已满，请先撤回或完成部分消息。",
    run_active: "当前任务尚未结束，可将新消息加入队列或立即调整。",
    provider_output_limit: "回答超出本轮输出上限，已保留现有内容。可以继续或缩小本轮范围。",
    execution_context_required: "原任务包含已授权的学习资料，请重新开启本会话的学习上下文后继续。",
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
  if (learningErrors[code]) return learningErrors[code];
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
  if (code.includes("session_full"))
    return "此会话已达到保存上限，请新建对话。";
  if (code.includes("ENOENT")) return "没有找到这段对话，请刷新会话列表。";
  return "操作未完成。请重试；若是模型连接问题，请检查所选模型的配置和网络。";
}
