import crypto from "node:crypto";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { AuditLogger } from "./audit.js";
import { RunManager } from "./run-manager.js";
import { WorkflowLedger } from "./workflow-ledger.js";
import type { TopicId } from "./contracts.js";
import { ZhixingDatabase } from "./database.js";
import { importStagedDocument } from "./import-command.js";
import { DocumentLibrary } from "./library.js";
import { PathPolicy } from "./paths.js";
import { MockModelClient } from "./model.js";
import { ProviderRegistry } from "./provider-registry.js";
import { ProviderRuntime } from "./provider-runtime.js";
import { ModelRoutingStore } from "./model-routing-store.js";
import { MacOSKeychainSecretStore } from "./macos-keychain.js";
import { ProviderSetup } from "./provider-setup.js";
import { DeepSeekClient } from "./deepseek-client.js";
import { CodexCliClient } from "./codex-client.js";
import { previewBackup, restoreBackup } from "./backup-service.js";
import { answerFromEvidence } from "./grounded-answer.js";
import { readHiddenSecret } from "./hidden-secret-input.js";
import { type EvidenceInput } from "./reviewer.js";
import { LearningRuntime } from "./runtime.js";
import { assertSupportedNodeVersion } from "./runtime-version.js";
import { SkillCatalog } from "./skill-catalog.js";
import { createDefaultTopicRegistry } from "./topics.js";
import { LocalSyncServer } from "./sync-server.js";
import { LearningProfileStore } from "./learning-profile.js";
import { GeneratedSkillStore } from "./generated-skill-store.js";
import { collectInvocation } from "./model-invocation.js";
import { TopicStore } from "./topic-store.js";
import { CustomCourseStore } from "./custom-course-store.js";
import { ReminderStore } from "./reminder-store.js";
import { conversationPlanSchema, formatIntentProposal, intentSchema, isAutomatableConversationCommand, parseLocalIntent, requiresConversationConfirmation, type ConversationPlan } from "./intent-parser.js";
import { interpretTeachingInput, type TeachingAction } from "./teaching-dialogue.js";
import { authorizationMessage, decideInteraction, nextInteractionMode } from "./interaction-protocol.js";
import { CurrentTopicStore } from "./current-topic-store.js";
import { TeachingSessionStore, type TeachingSession } from "./teaching-session-store.js";
import { LearningContextBuilder } from "./learning-context.js";
import { authorizeConversationTransition } from "./conversation-policy.js";

assertSupportedNodeVersion();
const root = process.env.ZHIXING_ROOT ? path.resolve(process.env.ZHIXING_ROOT) : path.resolve(import.meta.dirname, "../..");
const policy = new PathPolicy(root);
const registry = createDefaultTopicRegistry();
const topicStore = new TopicStore(root);
await topicStore.load(registry);
const runtime = new LearningRuntime(registry, policy);
let database = new ZhixingDatabase(path.join(root, "zhixing", "db", "zhixing.sqlite"));
let library = new DocumentLibrary(database, policy);
const audit = new AuditLogger(policy);
let workflowLedger = new WorkflowLedger(database);
const interruptedRuns = workflowLedger.reconcileInterrupted();
let runs = new RunManager(audit, workflowLedger);
const providerRegistry = new ProviderRegistry();
const mockProvider = new MockModelClient();
const keychain = new MacOSKeychainSecretStore();
providerRegistry.register({ id: "mock", client: mockProvider, health: async () => "healthy" });
providerRegistry.register({ id: "deepseek-api", client: new DeepSeekClient(keychain), health: async () => await keychain.get("keychain:zhixing/deepseek-api") ? "healthy" : "unavailable" });
// `codex exec` is the supported non-interactive CLI surface. The experimental
// app-server can start successfully but stall before producing an assistant turn.
providerRegistry.register({ id: "codex-cli", client: new CodexCliClient(undefined, process.env, 150_000), health: async () => process.env.ZHIXING_ALLOW_LIVE_PROVIDER === "0" ? "unavailable" : "unknown" });
providerRegistry.route("tutor", "mock");
providerRegistry.route("reviewer", "mock");
providerRegistry.route("lab", "mock");
const routingStore = new ModelRoutingStore(path.join(root, "zhixing", "settings", "model-routing.local.json"));
await routingStore.load(providerRegistry);
const providers = new ProviderRuntime(providerRegistry, mockProvider);
const providerSetup = new ProviderSetup(keychain);
const skills = new SkillCatalog(path.join(root, "zhixing"));
const learningProfiles = new LearningProfileStore(policy);
const generatedSkills = new GeneratedSkillStore(path.join(root, "zhixing"), policy);
const customCourses = new CustomCourseStore(root);
const reminders = new ReminderStore(policy);
let syncServer: LocalSyncServer | undefined;
let conversationalMode = true;
let teachingMode = false;
let teachingSession: TeachingSession | undefined;
const conversation: string[] = [];
let pendingConversationPlan: Extract<ConversationPlan, { kind: "proposal" }> | undefined;
const rawArguments = process.argv.slice(2);
const replMode = rawArguments.includes("--repl");
const topicArgumentIndex = rawArguments.indexOf("--topic");
const requestedTopic = topicArgumentIndex >= 0 ? rawArguments[topicArgumentIndex + 1] : undefined;
const currentTopicStore = new CurrentTopicStore(path.join(root, "zhixing", "settings", "current-topic.local.json"));
const savedTopic = await currentTopicStore.load();
let activeTopic: TopicId = registry.list().find((topic) => topic.topicId === requestedTopic)?.topicId ?? registry.list().find((topic) => topic.topicId === savedTopic)?.topicId ?? "agent-development";
const teachingSessions = new TeachingSessionStore(policy);
let learningContext = new LearningContextBuilder(learningProfiles, database, library);
teachingSession = await teachingSessions.load(activeTopic);
teachingMode = Boolean(teachingSession);
const argumentsWithoutRepl = rawArguments.filter((argument, index) => argument !== "--repl" && argument !== "--topic" && (topicArgumentIndex < 0 || index !== topicArgumentIndex + 1));
const input = argumentsWithoutRepl.join(" ");

// The persisted provider setting is the user's session-level permission for
// bounded learning context. Set ZHIXING_ALLOW_LIVE_PROVIDER=0 to disable it.
const liveProviderConsent = process.env.ZHIXING_ALLOW_LIVE_PROVIDER !== "0";

async function selectActiveTopic(topicId: TopicId): Promise<void> {
  activeTopic = topicId;
  teachingSession = await teachingSessions.load(activeTopic);
  teachingMode = Boolean(teachingSession);
  await currentTopicStore.save(activeTopic);
}

async function restoreDatabaseSafely(file: string): Promise<void> {
  await previewBackup(file);
  database.close();
  try {
    await restoreBackup(file, path.join(root, "zhixing", "db", "zhixing.sqlite"), true);
  } catch (error) {
    database = new ZhixingDatabase(path.join(root, "zhixing", "db", "zhixing.sqlite"));
    workflowLedger = new WorkflowLedger(database);
    runs = new RunManager(audit, workflowLedger);
    library = new DocumentLibrary(database, policy);
    learningContext = new LearningContextBuilder(learningProfiles, database, library);
    throw error;
  }
  database = new ZhixingDatabase(path.join(root, "zhixing", "db", "zhixing.sqlite"));
  workflowLedger = new WorkflowLedger(database);
  runs = new RunManager(audit, workflowLedger);
  library = new DocumentLibrary(database, policy);
  learningContext = new LearningContextBuilder(learningProfiles, database, library);
}

async function execute(line: string): Promise<string> {
  const command = line.trim();
  const interaction = decideInteraction(command, nextInteractionMode(Boolean(teachingSession), Boolean(pendingConversationPlan)));
  const authorizationError = authorizationMessage(interaction);
  if (authorizationError) return authorizationError;
  const confirmConversationPlan = interaction.kind === "execute_pending" && interaction.confirmed;
  if (interaction.kind === "execute_pending") return run("execute_conversation_plan", activeTopic, async () => {
    if (!pendingConversationPlan) return "没有待执行草案。请先描述你的学习目标，待知行给出“可直接运行”的计划后再确认。";
    const plan = pendingConversationPlan;
    const highRisk = plan.actions.filter((action): action is Extract<typeof action, { type: "command" }> => action.type === "command" && requiresConversationConfirmation(action.command));
    const policyDecision = authorizeConversationTransition({ source: "model_proposal", mutatesState: true, userConfirmed: true, explicitlyConfirmed: confirmConversationPlan, requiresExplicitConfirmation: highRisk.length > 0 });
    if (!policyDecision.allowed) return `该草案包含需人工授权的操作：${highRisk.map((action) => action.command).join("；")}\n请核对后回复“直接运行 --确认”或“我确认执行”。`;
    const topic = registry.list().find((item) => item.topicId === plan.topicId);
    const createsTopic = plan.actions.some((action) => action.type === "command" && new RegExp(`^创建主题\\s+${plan.topicId}\\s+`).test(action.command));
    if (!topic && !createsTopic) return `待执行草案的主题不存在：${plan.topicId}，且草案没有创建该主题的动作。请重新生成计划。`;
    await selectActiveTopic(plan.topicId as TopicId);
    const results: string[] = [];
    for (const action of plan.actions) {
      if (action.type === "set_learning_profile") {
        await learningProfiles.save(activeTopic, { goal: action.goal, level: action.level, dailyMinutes: action.dailyMinutes, totalDays: action.totalDays });
        results.push(`已保存学习画像：${activeTopic}（${action.dailyMinutes} 分钟/天，${action.totalDays} 天）`);
      } else if (action.type === "generate_custom_course") {
        const profile = await learningProfiles.load(activeTopic);
        if (!profile) throw new Error("learning_profile_required");
        const version = await customCourses.propose(activeTopic, registry.get(activeTopic).title, profile);
        await customCourses.activate(activeTopic, version);
        results.push(`已生成并启用定制课程：${version}`);
      } else if (isAutomatableConversationCommand(action.command)) {
        results.push(await executeConversationCommand(action.command));
      } else {
        throw new Error("conversation_action_denied: 草案包含未授权命令。");
      }
    }
    pendingConversationPlan = undefined;
    conversation.push(`执行结果：${results.join("；")}`);
    const overview = plan.actions.some((action) => action.type === "generate_custom_course") ? `\n\n${await formatCourseOverview(activeTopic)}` : "";
    return `${results.join("\n")}${overview}\n\n下一步：输入“开始第 1 天”开始学习；需要调整时可说“调整当前学习计划”。`;
  });
  if (command === "自然交互开启 --允许外发") {
    conversationalMode = true; conversation.length = 0;
    return "已开启自然交互模式。未识别的输入会交给当前 tutor 追问和生成草案；模型不会直接执行创建、覆盖或删除操作。";
  }
  if (command === "自然交互关闭") {
    conversationalMode = false; conversation.length = 0;
    return "已关闭自然交互模式。";
  }
  const modelIntent = /^理解命令\s+(.+?)\s+--允许外发$/.exec(command)?.[1];
  if (modelIntent) return run("model_intent_proposal", activeTopic, async (lifecycle, signal) => {
    const prompt = `将以下学习请求转换为 JSON，不执行任何操作。仅允许 intent=next_step|progress|create_topic|custom_course|unknown；创建主题时提供安全 kebab-case topicId 和 title。请求：${modelIntent}`;
    announceModelWork();
    const result = await collectInvocation(providers, { role: "tutor", providerId: "routed", prompt, containsUserMaterials: true, confirmed: liveProviderConsent, onAudit: (record) => lifecycle.model(record.providerId, record.role, record.durationMs, record.status, record) }, signal);
    const json = /\{[\s\S]*\}/.exec(result.text)?.[0];
    try { return formatIntentProposal(intentSchema.parse(JSON.parse(json ?? ""))); } catch { return "模型建议无法通过结构化校验；请使用明确命令。"; }
  });
  const createTopic = /^创建主题\s+([a-z0-9][a-z0-9-]*)\s+(.+)$/.exec(command);
  if (createTopic) return run("create_topic", activeTopic, async () => {
    const topic = await topicStore.create(registry, createTopic[1]!, createTopic[2]!.trim());
    await selectActiveTopic(topic.topicId);
    return `已创建主题：${topic.topicId}（${topic.title}）\n已初始化：计划、Skill 目录和 inbox/${topic.topicId}/。下一步：设置学习画像 <目标> --水平 <当前水平> --每天 <15–480> --周期 <1–180>`;
  });
  const syncPort = /^启动同步服务(?:\s+(\d{1,5}))?$/.exec(command)?.[1];
  if (/^启动同步服务(?:\s+\d{1,5})?$/.test(command)) {
    if (syncServer) return "同步服务已启动。";
    syncServer = new LocalSyncServer(async (topicId) => runtime.handle("进度", topicId), registry.list().map((topic) => topic.topicId));
    const port = await syncServer.listen(syncPort ? Number(syncPort) : 0);
    return `本地同步服务已启动：http://127.0.0.1:${port}/topics/<topicId>/progress（SSE：/events）`;
  }
  const topicSelection = /^学习\s+(.+)$/.exec(command)?.[1]?.trim();
  if (topicSelection) {
    const topic = registry.list().find((item) => item.topicId === topicSelection || item.title.includes(topicSelection));
    if (topic) await selectActiveTopic(topic.topicId);
  }
  const addApiKey = /^模型添加\s+api-key\s+([a-z][a-z0-9-]*)$/.exec(command)?.[1];
  if (addApiKey) return run("configure_api_key", activeTopic, async () => {
    const secret = await readHiddenSecret(`请输入 ${addApiKey} API Key（隐藏输入）：`);
    const configured = await providerSetup.configureApiKey(addApiKey, secret);
    return `已安全保存 ${configured.secretRef}`;
  });
  if (command === "模型列表") return run("provider_list", activeTopic, async () => {
    const entries = await Promise.all(providerRegistry.providerIds().map(async (id) => `${id}：${await providers.status(id, new AbortController().signal)}`));
    return entries.join("\n");
  });
  if (command === "模型状态") return run("provider_status", activeTopic, async () => {
    const health = await Promise.all(providerRegistry.providerIds().map(async (id) => `${id}：${await providers.status(id, new AbortController().signal)}`));
    const routes = (["tutor", "reviewer", "lab"] as const).map((role) => `${role} -> ${providerRegistry.routedProvider(role) ?? "fallback"}`);
    return [...health, ...routes].join("\n");
  });
  if (command === "诊断") return run("agent_diagnostics", activeTopic, async () => {
    const [profile, reminder] = await Promise.all([learningProfiles.load(activeTopic), reminders.status(activeTopic)]);
    const health = await Promise.all(providerRegistry.providerIds().map(async (id) => `${id}=${await providers.status(id, new AbortController().signal)}`));
    const session = await teachingSessions.load(activeTopic);
    const documents = library.list(activeTopic);
    const recentRuns = workflowLedger.recent(activeTopic).map((item) => `${item.actionId}:${item.status}${item.errorCode ? `(${item.errorCode})` : ""}`).join("；") || "无";
    return `知行诊断\n主题：${activeTopic}\nProvider：${health.join("；")}\nTutor 路由：${providerRegistry.routedProvider("tutor") ?? "mock"}\n教学检查点：${session ? `${session.dayId ?? "当前任务"} / ${session.stage} / 第 ${session.quizRound} 轮练习` : "无（可开始学习）"}\n学习画像：${profile ? "已设置" : "未设置"}\n记忆：${database.memoryCount(activeTopic)} 条\n资料：${documents.length} 份\n提醒：${reminder ? `每天 ${reminder.time}` : "未设置"}\n最近运行：${recentRuns}\n运行恢复：${interruptedRuns ? `检测到并安全终止 ${interruptedRuns} 个中断运行；请重新发起对应操作。` : "无中断运行。"}\n恢复：重启 REPL 后会恢复当前主题和教学检查点。`;
  });
  const switchModel = /^模型切换\s+(tutor|reviewer|lab)\s+([a-z][a-z0-9-]*)(?:\s+--确认)?$/.exec(command);
  const switchRole = switchModel?.[1] as "tutor" | "reviewer" | "lab" | undefined;
  const switchProvider = switchModel?.[2];
  if (switchRole && switchProvider) return run("update_model_routing", activeTopic, async () => {
    providerRegistry.route(switchRole, switchProvider);
    await routingStore.save(providerRegistry);
    return `已切换：${switchRole} -> ${switchProvider}`;
  });
  const profile = /^设置学习画像\s+(.+?)\s+--水平\s+(.+?)\s+--每天\s+(\d+)\s+--周期\s+(\d+)$/.exec(command);
  if (profile) return run("save_learning_profile", activeTopic, async () => {
    await learningProfiles.save(activeTopic, { goal: profile[1]!.trim(), level: profile[2]!.trim(), dailyMinutes: Number(profile[3]), totalDays: Number(profile[4]) });
    return `已保存学习画像：${activeTopic}\n目标：${profile[1]!.trim()}\n水平：${profile[2]!.trim()}\n节奏：每天 ${profile[3]} 分钟，${profile[4]} 天`;
  });
  if (command === "学习画像") return run("read_learning_profile", activeTopic, async () => {
    const profile = await learningProfiles.load(activeTopic);
    return profile ? `目标：${profile.goal}\n水平：${profile.level}\n节奏：每天 ${profile.dailyMinutes} 分钟，共 ${profile.totalDays} 天` : "尚未设置学习画像。使用：设置学习画像 <目标> --水平 <当前水平> --每天 <15–480> --周期 <1–180>";
  });
  if (command === "生成个性化计划") return run("propose_personal_plan", activeTopic, async () => {
    const version = await learningProfiles.proposePlan(activeTopic);
    return `已生成个性化计划草案：${version}\n请检查后使用“启用个性化计划 ${version}”确认。`;
  });
  if (command === "生成定制课程") return run("propose_custom_course", activeTopic, async () => {
    const profile = await learningProfiles.load(activeTopic);
    if (!profile) throw new Error("learning_profile_required: 请先设置学习画像。");
    const version = await customCourses.propose(activeTopic, registry.get(activeTopic).title, profile);
    return `已生成定制课程草案：${version}\n请检查后使用“启用定制课程 ${version} --确认”替换当前主题计划；旧计划会备份。`;
  });
  const activateCourse = /^启用定制课程\s+(course-[\dTZ-]+)(\s+--确认)?$/.exec(command);
  if (activateCourse) return run("activate_custom_course", activeTopic, async () => {
    if (!activateCourse[2]) throw new Error("course_activation_confirmation_required");
    await customCourses.activate(activeTopic, activateCourse[1]!);
    return `已启用定制课程：${activateCourse[1]}。旧计划已备份到主题笔记。\n\n${await formatCourseOverview(activeTopic)}`;
  });
  const activatePersonalPlan = /^启用个性化计划\s+(personal-plan-[\dTZ-]+)(?:\s+--确认)?$/.exec(command)?.[1];
  if (activatePersonalPlan) return run("activate_personal_plan", activeTopic, async () => {
    await learningProfiles.activatePlan(activeTopic, activatePersonalPlan);
    return `已启用个性化计划：${activatePersonalPlan}`;
  });
  const generateSkill = /^生成技能草案\s+([a-z][a-z0-9-]{1,62})$/.exec(command)?.[1];
  if (generateSkill) return run("generate_skill_draft", activeTopic, async () => {
    const profile = await learningProfiles.load(activeTopic);
    if (!profile) throw new Error("learning_profile_required: 请先设置学习画像。");
    await generatedSkills.createDraft(activeTopic, generateSkill, profile);
    return `已生成本地 Skill 草案：${generateSkill}\n使用“读取技能草案 ${generateSkill}”检查；使用“启用技能草案 ${generateSkill}”加入当前主题。`;
  });
  if (command === "技能草案列表") return run("list_skill_drafts", activeTopic, async () => {
    const drafts = await generatedSkills.listDrafts(activeTopic);
    return drafts.length ? drafts.join("\n") : "当前主题没有 Skill 草案。";
  });
  const readSkillDraft = /^读取技能草案\s+([a-z][a-z0-9-]{1,62})$/.exec(command)?.[1];
  if (readSkillDraft) return run("read_skill_draft", activeTopic, () => generatedSkills.readDraft(activeTopic, readSkillDraft));
  const activateSkillDraft = /^启用技能草案\s+([a-z][a-z0-9-]{1,62})(?:\s+--确认)?$/.exec(command)?.[1];
  if (activateSkillDraft) return run("activate_skill_draft", activeTopic, async () => {
    await generatedSkills.activate(activeTopic, activateSkillDraft);
    return `已启用主题 Skill：${activateSkillDraft}`;
  });
  const adjust = /^调整计划\s+(\d+)$/.exec(command)?.[1];
  if (adjust) return run("propose_plan", activeTopic, () => runtime.proposePlan(activeTopic, Number(adjust)));
  const activate = /^启用计划\s+(plan-[\dTZ-]+)$/.exec(command)?.[1];
  if (activate) return run("activate_plan", activeTopic, () => runtime.activatePlan(activeTopic, activate));
  if (command === "复习计划") return run("create_review_plan", activeTopic, () => runtime.createReviewPlan(activeTopic));
  const skillList = /^技能列表(?:\s+([a-z][a-z0-9-]*))?$/.exec(command);
  if (skillList) return run("list_skills", (skillList[1] as TopicId | undefined) ?? activeTopic, async () => {
    const topicId = (skillList[1] as TopicId | undefined) ?? activeTopic;
    const list = await skills.list(topicId);
    return list.length ? list.map((skill) => `${skill.name}\t${skill.scope}\t${skill.description}`).join("\n") : "当前主题没有可用 Skill。";
  });
  const readSkill = /^读取技能\s+([\w-]+)$/.exec(command)?.[1];
  if (readSkill) return run("read_skill", activeTopic, () => skills.read(activeTopic, readSkill));
  const importFile = /^导入资料\s+(.+)$/.exec(command)?.[1];
  if (importFile) return run("import_document", activeTopic, async () => {
    const result = await importStagedDocument(root, library, importFile);
    await selectActiveTopic(result.topicId);
    return `导入结果：${result.status}\n主题：${result.topicId}\n文档：${result.documentId || "—"}\n分块：${result.chunks}${result.reason ? `\n原因：${result.reason}` : ""}`;
  });
  if (command === "资料库") return run("list_library", activeTopic, async () => {
    const documents = library.list(activeTopic);
    return documents.length ? documents.map((document) => `${document.name}\t${document.status}\t${document.id}`).join("\n") : "当前主题没有已导入资料。";
  });
  if (command === "资料概览") return run("summarize_library", activeTopic, async () => {
    const documents = library.list(activeTopic);
    const profile = await learningProfiles.load(activeTopic);
    const activePlan = profile ? "已设置画像；可生成个性化计划。" : "未设置学习画像。";
    return `主题：${activeTopic}\n资料：${documents.length} 份${documents.length ? `\n${documents.map((document) => `- ${document.name}（${document.status}）`).join("\n")}` : ""}\n${activePlan}\n提示：资料以主题隔离；删除仍需先预览再确认。`;
  });
  if (command === "主题概览") return run("topic_overview", activeTopic, async () => {
    const [profile, reminder] = await Promise.all([learningProfiles.load(activeTopic), reminders.status(activeTopic)]);
    const documents = library.list(activeTopic);
    const progress = await runtime.handle("进度", activeTopic);
    return `主题：${registry.get(activeTopic).title}\n${progress}\n资料：${documents.length} 份\n画像：${profile ? `${profile.goal}（每天 ${profile.dailyMinutes} 分钟）` : "未设置"}\n提醒：${reminder ? `每天 ${reminder.time}（仅本地计划）` : "未设置"}`;
  });
  const reminder = /^提醒设置\s+([0-2]\d:[0-5]\d)$/.exec(command)?.[1];
  if (reminder) return run("set_reminder", activeTopic, async () => { await reminders.set(activeTopic, reminder); return `已设置本地提醒计划：每天 ${reminder}。当前版本不会启动后台通知；可在“主题概览”查看。 `; });
  if (command === "下一步") return run("next_step", activeTopic, async () => {
    const reminder = await reminders.status(activeTopic);
    const next = await runtime.handle("继续", activeTopic);
    return `${next}${reminder ? `\n提醒计划：每天 ${reminder.time}（本地记录，未启动后台通知）。` : "\n提示：可使用“提醒设置 HH:MM”记录学习提醒计划。"}`;
  });
  const coaching = /^学习建议(\s+--允许外发)?$/.exec(command);
  if (coaching) return run("learning_guidance", activeTopic, async (lifecycle, signal) => {
    const profile = await learningProfiles.load(activeTopic);
    if (!profile) return "请先设置学习画像，再生成建议。";
    const documents = library.list(activeTopic);
    const prompt = `你是学习教练。基于以下仅含元数据的学习画像和资料清单，给出一个 ${profile.dailyMinutes} 分钟学习会话：一个目标、一个练习、一个失败案例、一个复盘问题。不得声称完成学习日，不得要求读取未提供的资料。\n主题：${activeTopic}\n目标：${profile.goal}\n水平：${profile.level}\n周期：${profile.totalDays} 天\n资料名称：${documents.map((document) => document.name).join("、") || "无"}`;
    announceModelWork();
    const result = await collectInvocation(providers, { role: "tutor", providerId: "routed", prompt, containsUserMaterials: true, confirmed: liveProviderConsent, onAudit: (record) => lifecycle.model(record.providerId, record.role, record.durationMs, record.status, record) }, signal);
    return result.text;
  });
  const remember = /^记住\s+(.+?)(\s+--确认)?$/.exec(command);
  const memoryContent = remember?.[1];
  if (memoryContent) return run("write_memory", activeTopic, async () => {
    if (!remember?.[2]) throw new Error("confirmation_required: 使用“记住 <内容> --确认”写入长期记忆。");
    const id = crypto.randomUUID();
    database.writeMemory(id, { topicId: activeTopic, type: "learning_fact", content: memoryContent.trim(), sourceKind: "user", sourceRef: "user:explicit", confidence: 1, confirmed: true });
    return `已记住：${id}`;
  });
  const memoryQuery = /^查询记忆\s+(.+)$/.exec(command)?.[1];
  if (memoryQuery) return run("search_memory", activeTopic, async () => {
    const { topicId, question } = resolveTopicQuery(memoryQuery);
    const memories = database.searchMemories(topicId, question);
    return memories.length ? memories.map((memory) => `${memory.id}\n${memory.content}\n来源：${memory.sourceRef}`).join("\n\n") : "当前主题没有匹配记忆。";
  });
  const globalMemoryQuery = /^全局查询记忆\s+(.+)$/.exec(command)?.[1];
  if (globalMemoryQuery) return run("search_memory_global", activeTopic, async () => {
    const memories = database.searchAllMemories(globalMemoryQuery);
    return memories.length ? memories.map((memory) => `[${memory.topicId}] ${memory.id}\n${memory.content}\n来源：${memory.sourceRef}`).join("\n\n") : "没有匹配记忆。";
  });
  const forget = /^忘记\s+([\w-]+)$/.exec(command)?.[1];
  if (forget) return run("delete_memory", activeTopic, async () => database.deleteMemory(activeTopic, forget) ? `已忘记：${forget}` : "未找到可删除记忆。");
  const preview = /^资料删除预览\s+([a-z][a-z0-9-]*)\s+([\w-]+)$/.exec(command);
  const previewTopic = preview?.[1] as TopicId | undefined;
  const previewDocument = preview?.[2];
  if (previewTopic && previewDocument) return run("preview_document_delete", previewTopic, async () => {
    const impact = library.previewDeletion(previewTopic, previewDocument);
    return impact ? `删除影响：文档=${impact.name}，Chunk=${impact.chunks}。使用“删除资料 ${previewTopic} ${previewDocument} --确认”执行。` : "document_not_found";
  });
  const remove = /^删除资料\s+([a-z][a-z0-9-]*)\s+([\w-]+)(\s+--确认)?$/.exec(command);
  const removeTopic = remove?.[1] as TopicId | undefined;
  const removeDocument = remove?.[2];
  if (removeTopic && removeDocument) return run("delete_document", removeTopic, async () => {
    const deleted = await library.deleteDocument(removeTopic, removeDocument, Boolean(remove?.[3]));
    return `已删除资料：${deleted.name}，Chunk=${deleted.chunks}`;
  });
  if (command === "备份数据库") return run("backup_database", activeTopic, async () => {
    const target = path.join(root, "zhixing", "db", "backups", `${new Date().toISOString().replaceAll(":", "-")}.sqlite`);
    await database.backup(target);
    return `数据库备份完成：${path.basename(target)}`;
  });
  const previewBackupCommand = /^备份预览\s+([^\s]+)$/.exec(command)?.[1];
  if (previewBackupCommand) return run("preview_backup", activeTopic, async () => {
    const file = backupFile(previewBackupCommand);
    const preview = await previewBackup(file);
    return `备份预览：${path.basename(file)}，字节=${preview.bytes}，migrations=${preview.migrations}`;
  });
  const restoreBackupCommand = /^恢复数据库\s+([^\s]+)(\s+--确认)?$/.exec(command);
  const restoreBackupName = restoreBackupCommand?.[1];
  if (restoreBackupName) return run("restore_backup", activeTopic, async () => {
    if (!restoreBackupCommand?.[2]) throw new Error("restore_confirmation_required");
    await restoreDatabaseSafely(backupFile(restoreBackupName));
    return "数据库恢复完成，已重新打开数据库连接。";
  });
  const answer = /^资料问答\s+(.+?)(\s+--允许外发)?$/.exec(command);
  const answerQuestion = answer?.[1];
  if (answerQuestion) return run("grounded_answer", activeTopic, async (lifecycle, signal) => {
    const { topicId, question } = resolveTopicQuery(answerQuestion);
    const evidence = library.search(topicId, question);
    const workflowSkills = (await skills.list(topicId)).map((skill) => ({ name: skill.name, description: skill.description }));
    return answerFromEvidence(providers, question, evidence, true, signal, (providerId, role, durationMs, status) => lifecycle.model(providerId, role, durationMs, status), undefined, workflowSkills);
  });
  const query = /^查询资料\s+(.+)$/.exec(command)?.[1];
  if (query) return run("search_library", activeTopic, async () => {
    const { topicId, question } = resolveTopicQuery(query);
    return formatSearch(topicId, question);
  });
  const reviewMatch = /^检查\s+(D\d{2})(.*)$/.exec(command);
  const reviewDay = reviewMatch?.[1];
  if (reviewDay && reviewMatch) return run("review_evidence", activeTopic, async () => {
    const flags = reviewMatch[2] ?? "";
    const evidence: EvidenceInput = {
      implementation: flags.includes("--实现"),
      testOutput: flags.includes("--测试"),
      failureCase: flags.includes("--失败"),
      reflection: flags.includes("--复盘"),
    };
    return runtime.reviewDay(activeTopic, reviewDay, evidence);
  });
  const startDayCommand = /^开始第\s*\d+\s*天$/.test(command);
  if (startDayCommand) return run("guided_start_day", activeTopic, async (lifecycle, signal) => {
    const dayNumber = /^开始第\s*(\d+)\s*天$/.exec(command)?.[1];
    const requestedDayId = dayNumber ? `D${dayNumber.padStart(2, "0")}` : undefined;
    if (teachingSession?.topicId === activeTopic && teachingSession.dayId === requestedDayId) {
      teachingMode = true;
      return `已恢复 ${activeTopic}/${teachingSession.dayId} 的教学现场（${teachingSession.stage}）。${teachingSession.stage === "practice" ? "可直接继续回答当前练习。" : "可直接提问；没有疑问时输入“没有问题，开始练习”。"}`;
    }
    const dayCard = await runtime.handle(command, activeTopic);
    const routed = providerRegistry.routedProvider("tutor") ?? "mock";
    if (routed === "mock" || dayCard.startsWith("不能开始")) return dayCard;
    announceModelWork(routed);
    const streamed = beginLiveModelText("教师讲解（实时）");
    const result = await collectInvocation(providers, { role: "tutor", providerId: "routed", prompt: `你是纯文本学习教师，不是编码代理。立即开始中文讲解；不得读取文件、检查工作区、调用工具、描述将要执行的动作，或输出 Shell。基于以下当天学习卡，为有一定学习能力的用户进行严谨、细致的中文授课。先说明本日内容在整个课程中的位置和完成后能解决的问题；再用不少于 800 个中文字符讲解核心概念、因果关系或推导逻辑，给一个具体例子并指出至少两个常见误区。最后只提出 1 个诊断问题，并邀请用户先提问：明确告诉用户“有疑问可直接问；确认没有疑问后输入‘没有问题，开始练习’，我才会出题”。此阶段不得布置测验或实验。\n${dayCard}`, containsUserMaterials: true, confirmed: liveProviderConsent, allowFallback: false, onText: streamed, onAudit: (record) => lifecycle.model(record.providerId, record.role, record.durationMs, record.status, record) }, signal);
    teachingMode = true;
    teachingSession = await teachingSessions.save(activeTopic, { dayId: /\/(D\d{2})/.exec(dayCard)?.[1], dayCard, stage: "answer_questions", quizRound: 0, transcript: result.text ? [`教师：${result.text}`] : [] });
    const completion = result.partial ? "讲解只返回了部分内容；可直接追问“继续刚才的讲解”，或稍后重试。" : "讲解已完成。请先提问或回答诊断问题；确认没有疑问后输入“没有问题，开始练习”。";
    return streamed ? `\n\n本日学习卡\n${dayCard}\n\n${completion}` : `${dayCard}\n\n教师讲解\n${result.text}\n\n${completion}`;
  });
  if (/^开始任/.test(command) && command !== "开始任务") return execute("开始任务");
  if (command === "开始任务") return run("guided_learning_task", activeTopic, async (lifecycle, signal) => {
    if (teachingSession?.topicId === activeTopic) return `当前教学已在 ${teachingSession.dayId ?? "本日"} 进行中。${teachingSession.stage === "practice" ? "请直接回答当前练习。" : "请直接提问；没有疑问时输入“没有问题，开始练习”。"}`;
    const taskCard = await runtime.handle(command, activeTopic);
    const routed = providerRegistry.routedProvider("tutor") ?? "mock";
    if (routed === "mock") return taskCard;
    const profile = await learningProfiles.load(activeTopic);
    const enabledSkills = (await skills.list(activeTopic)).map((skill) => `${skill.name}: ${skill.description}`).join("；") || "无";
    const prompt = `你是知行的专业教学 tutor。现在开始 ${activeTopic} 的学习任务，面向 ${profile?.level ?? "学习者"}。请按已启用 Skill 设计严谨、细致的中文讲解：不少于 800 个中文字符，包含概念、原理/推导、具体例子、边界条件和常见误区。最后仅给一个诊断问题，并明确邀请用户提问；只有用户确认“没有问题，开始练习”后才进入测验。不要调用工具、输出 Shell 或声称用户已完成。已启用 Skill：${enabledSkills}\n学习状态卡：\n${taskCard}`;
    announceModelWork(routed);
    const streamed = beginLiveModelText("教师讲解（实时）");
    const result = await collectInvocation(providers, { role: "tutor", providerId: "routed", prompt, containsUserMaterials: true, confirmed: liveProviderConsent, allowFallback: false, onText: streamed, onAudit: (record) => lifecycle.model(record.providerId, record.role, record.durationMs, record.status, record) }, signal);
    conversation.push(`Tutor：${result.text}`);
    teachingMode = true;
    teachingSession = await teachingSessions.save(activeTopic, { dayId: /开始\s+(D\d{2})/.exec(taskCard)?.[1], dayCard: taskCard, stage: "answer_questions", quizRound: 0, transcript: result.text ? [`教师：${result.text}`] : [] });
    const completion = result.partial ? "讲解只返回了部分内容；可直接追问“继续刚才的讲解”，或稍后重试。" : "讲解已完成。现在可以直接提问；确认没有疑问后输入“没有问题，开始练习”。";
    return streamed ? `\n\n${completion}` : `教师讲解\n${result.text}\n\n${completion}`;
  });
  const localIntent = parseLocalIntent(command);
  if (localIntent.intent?.intent === "next_step") return execute("下一步");
  if (localIntent.intent?.intent === "progress") return execute("进度");
  if (localIntent.intent?.intent === "current_topic") return `当前学习主题：${activeTopic}（${registry.get(activeTopic).title}）${teachingSession ? `\n教学阶段：${teachingSession.stage}${teachingSession.dayId ? `（${teachingSession.dayId}）` : ""}` : ""}`;
  // Deterministic learning-flow commands always take precedence over conversational interpretation.
  const deterministic = await runtime.handle(command, activeTopic);
  if (!deterministic.startsWith("支持：")) return run("learning_command", activeTopic, async () => deterministic);
  if (localIntent.candidates.length && !conversationalMode) return `未执行写操作。你可能想使用：\n${localIntent.candidates.map((candidate, index) => `${index + 1}. ${candidate}`).join("\n")}\n模型可用且你允许本次外发时，可使用“理解命令 <请求> --允许外发”生成命令草案。`;
  if (conversationalMode) return run("conversational_guidance", activeTopic, async (lifecycle, signal) => {
    const routed = providerRegistry.routedProvider("tutor") ?? "mock";
    if (routed === "mock") return "当前 tutor 是 mock，无法进行自然多轮辅导。执行“模型切换 tutor codex-cli”或“模型切换 tutor deepseek-api”后重试；也可继续使用明确 CLI 命令。";
    announceModelWork(routed);
    conversation.push(`用户：${command}`);
    if (teachingMode && /(调整|创建|新建|切换|导入|删除|提醒|模型|计划|课程)/.test(command)) teachingMode = false;
    if (interaction.kind === "teaching_input" && teachingMode) {
      const session = teachingSession?.topicId === activeTopic ? teachingSession : undefined;
      const actionPrompt = `将学习者在教学会话中的输入分类为一个 JSON 对象，不要 Markdown：{"action":"start_practice|answer_question|request_solution|ask_question|skip_question|change_plan","target":"current","learnerAnswer":"仅在实际作答时填写"}。“没有问题，开始练习”等确认进入练习为 start_practice。索要答案、提示、讲解绝不是作答；不要虚构学习者答案。当前阶段=${session?.stage ?? "answer_questions"}；当前练习=${session?.currentExercise?.slice(0, 1500) ?? "无"}；输入=${command}`;
      const classified = await collectInvocation(providers, { role: "tutor", providerId: "routed", prompt: actionPrompt, containsUserMaterials: true, confirmed: liveProviderConsent, allowFallback: false, onAudit: (record) => lifecycle.model(record.providerId, record.role, record.durationMs, record.status, record) }, signal);
      const interpreted = interpretTeachingInput(classified.text, command);
      const action: TeachingAction = interpreted.action;
      const isPractice = session?.stage === "practice" || action.action === "start_practice" || action.action === "answer_question" || action.action === "request_solution" || action.action === "skip_question";
      const wantsSolution = action.action === "request_solution";
      if (session && (action.action === "start_practice" || action.action === "answer_question" || action.action === "request_solution" || action.action === "skip_question")) teachingSession = await teachingSessions.save(activeTopic, { ...session, stage: "practice", transcript: [...session.transcript, `用户：${command}`].slice(-12) });
      const practiceInstruction = wantsSolution
        ? "用户明确要求直接给出答案或解析；这不是用户作答。请针对当前练习中被请求的题目，先给出完整参考答案，再分步解释关键概念或推导，并说明常见误区。不得声称用户已经回答、不得批改虚构答案；给完后询问用户是否要自己尝试下一题。"
        : interpreted.hasVerifiedSubmission
          ? "用户已经实际提交了可验证的作答。请严谨批改，指出正确点、错误或缺失，并用当前题目给出针对性解释；不要把未回答的其他题目也判为完成。"
          : action.action === "start_practice"
            ? "用户已确认讲解阶段没有疑问，现在进入练习测验阶段。先用一两句话说明练习检验的能力，然后只出 2 道由浅入深的问题：第一题检查概念，第二题要求应用或推导。暂不公布答案，要求用户逐题作答。"
            : "用户尚未提交可验证的作答。请直接回应他的澄清问题、说明当前题意或邀请他作答；绝不能声称看到了答案、批改答案，或凭空生成用户答案。";
      const prompt = isPractice
        ? `你是正在带领用户学习 ${activeTopic} 的专业教师。${practiceInstruction}不要跳到实验、复盘或下一天，不要输出 JSON 或 Shell。\n${await learningContext.build(activeTopic, command, teachingSession)}\n学习卡：\n${session?.dayCard ?? "当前学习日"}\n最近对话：\n${[...(session?.transcript ?? []), ...conversation].slice(-12).join("\n")}`
        : `你是正在带领用户学习 ${activeTopic} 的专业教师，当前处于讲解后的答疑阶段。针对用户的问题或诊断回答，给出准确、细致、有例子的解释；必要时纠正其理解，但不要出题或进入实验。结尾必须询问“还有疑问吗？确认没有疑问后请输入‘没有问题，开始练习’。”不要输出 JSON、Shell 命令或计划草案。\n${await learningContext.build(activeTopic, command, teachingSession)}\n对话：\n${[...(session?.transcript ?? []), ...conversation].slice(-12).join("\n")}`;
      const streamed = beginLiveModelText(isPractice ? "练习测验（实时）" : "教师答疑（实时）");
      const result = await collectInvocation(providers, { role: "tutor", providerId: "routed", prompt, containsUserMaterials: true, confirmed: liveProviderConsent, allowFallback: false, onText: streamed, onAudit: (record) => lifecycle.model(record.providerId, record.role, record.durationMs, record.status, record) }, signal);
      conversation.push(`Tutor：${result.text}`);
      if (teachingSession) teachingSession = await teachingSessions.save(activeTopic, { ...teachingSession, stage: isPractice ? "practice" : teachingSession.stage, quizRound: isPractice ? teachingSession.quizRound + 1 : teachingSession.quizRound, transcript: [...teachingSession.transcript, `用户：${command}`, `教师：${result.text}`].filter(Boolean).slice(-12), currentExercise: isPractice ? result.text.slice(0, 8_000) : teachingSession.currentExercise, learnerAttempts: interpreted.hasVerifiedSubmission ? [...teachingSession.learnerAttempts, action.learnerAnswer!].slice(-8) : teachingSession.learnerAttempts });
      return streamed ? "\n\n本轮教学完成。" : result.text;
    }
    const history = conversation.slice(-6).join("\n");
    const topics = registry.list().map((topic) => `${topic.topicId}:${topic.title}`).join("、");
    const prompt = `你是知行学习 Agent 的对话协调器。只能返回一个 JSON 对象，不能使用 Markdown、Shell 命令或解释。可选格式：{"kind":"clarify","question":"只问一个最关键的问题"}；或 {"kind":"proposal","topicId":"主题ID","summary":"简短摘要","actions":[{"type":"set_learning_profile","goal":"...","level":"...","dailyMinutes":120,"totalDays":84},{"type":"generate_custom_course"}]}。也可在 actions 中使用 {"type":"command","command":"一条规范知行命令"}。允许的规范命令仅包括：主题列表、学习 <主题>、开始第 N 天、开始任务、下一步、进度、全部进度、继续、主题概览、学习画像、资料概览、技能草案列表、复习计划、创建主题、设置学习画像、生成个性化计划、生成定制课程、调整计划、提醒设置、生成/读取技能草案、读取技能、检查 DNN、读源码 DNN、查询资料、启用计划/课程/Skill、导入资料、删除资料、恢复数据库、模型切换。若用户要新主题，proposal 的首个 command 必须是“创建主题 <topicId> <标题>”，并且 topicId 与 proposal.topicId 相同；否则只能使用现有主题。不得使用 npm、bash、curl 或任何未列命令；不得声称已经执行。待执行草案含启用/覆盖、导入、删除、恢复或模型切换时，必须提示用户以“直接运行 --确认”人工授权。现有主题：${topics}。当前主题：${activeTopic}\n对话：\n${history}`;
    const result = await collectInvocation(providers, { role: "tutor", providerId: "routed", prompt, containsUserMaterials: true, confirmed: liveProviderConsent, allowFallback: false, onAudit: (record) => lifecycle.model(record.providerId, record.role, record.durationMs, record.status, record) }, signal);
    conversation.push(`Agent：${result.text}`);
    const json = /\{[\s\S]*\}/.exec(result.text)?.[0];
    try {
      const plan = conversationPlanSchema.parse(JSON.parse(json ?? ""));
      if (plan.kind === "clarify") return plan.question;
      pendingConversationPlan = plan;
      return `待执行草案：${plan.summary}\n主题：${plan.topicId}\n动作：${plan.actions.map((action) => action.type === "set_learning_profile" ? "保存学习画像" : action.type === "generate_custom_course" ? "生成定制课程草案" : action.command).join(" → ")}\n回复“直接运行”即可执行。`;
    } catch {
      return "模型未返回可校验的学习草案；请补充主题、目标、基础、每天时间和周期。";
    }
  });
  return run("learning_command", activeTopic, async () => deterministic);
}

function resolveTopicQuery(value: string): { topicId: TopicId; question: string } {
  const [candidate, ...rest] = value.trim().split(/\s+/);
  const explicitTopic = candidate ? registry.list().find((topic) => topic.topicId === candidate)?.topicId : undefined;
  return { topicId: explicitTopic ?? activeTopic, question: explicitTopic ? rest.join(" ") : value };
}

/** Keep REPL feedback concise and identical for every live-model interaction. */
function announceModelWork(providerId = providerRegistry.routedProvider("tutor") ?? "模型"): void {
  if (replMode) console.log(`正在由 ${providerId} 处理；可按 Ctrl-C 取消…`);
}

/** Streams model text in a REPL without printing the completed answer twice. */
function beginLiveModelText(label: string): ((text: string, providerId: string) => void) | undefined {
  if (!replMode) return undefined;
  let started = false;
  return (text) => {
    if (!started) { stdout.write(`\n${label}\n\n`); started = true; }
    stdout.write(text);
  };
}

async function formatCourseOverview(topicId: TopicId): Promise<string> {
  const profile = await learningProfiles.load(topicId);
  if (!profile) return "课程总览：画像尚未保存。";
  const phases = ["基础与术语：建立核心概念和资料地图", "原理与方法：理解关键机制并完成受控练习", "实现与调试：完成最小可运行实验，记录失败案例", "综合项目：整合成果、复盘并形成可展示证据"];
  const span = Math.ceil(profile.totalDays / phases.length);
  return `课程总览\n目标：${profile.goal}\n基础：${profile.level}\n节奏：${profile.totalDays} 天，每天 ${profile.dailyMinutes} 分钟\n${phases.map((phase, index) => `${index + 1}. 第 ${index * span + 1}–${Math.min((index + 1) * span, profile.totalDays)} 天：${phase}`).join("\n")}\n完成方式：每个学习日依次经历讲解、答疑、练习/测验、实验与证据 Review；Review 通过才会推进。`;
}

/** Executes a validated conversational command inside the current audit run (never recursively via execute()). */
async function executeConversationCommand(command: string): Promise<string> {
  if (command === "主题列表") return registry.list().map((topic) => `${topic.topicId}\t${topic.title}`).join("\n");
  if (command === "模型列表" || command === "模型状态") {
    const health = await Promise.all(providerRegistry.providerIds().map(async (id) => `${id}：${await providers.status(id, new AbortController().signal)}`));
    if (command === "模型列表") return health.join("\n");
    const routes = (["tutor", "reviewer", "lab"] as const).map((role) => `${role} -> ${providerRegistry.routedProvider(role) ?? "fallback"}`);
    return [...health, ...routes].join("\n");
  }
  if (command === "诊断") {
    const session = await teachingSessions.load(activeTopic);
    return `知行诊断\n主题：${activeTopic}\nTutor 路由：${providerRegistry.routedProvider("tutor") ?? "mock"}\n教学检查点：${session ? `${session.dayId ?? "当前任务"} / ${session.stage} / 第 ${session.quizRound} 轮练习` : "无"}\n记忆：${database.memoryCount(activeTopic)} 条\n资料：${library.list(activeTopic).length} 份`;
  }
  const topicSelection = /^学习\s+(.+)$/.exec(command)?.[1]?.trim();
  if (topicSelection) {
    const topic = registry.list().find((item) => item.topicId === topicSelection || item.title.includes(topicSelection));
    if (!topic) throw new Error(`topic_not_found: ${topicSelection}`);
    await selectActiveTopic(topic.topicId);
    return `已切换当前主题：${topic.topicId}（${topic.title}）`;
  }
  const createTopic = /^创建主题\s+([a-z0-9][a-z0-9-]*)\s+(.+)$/.exec(command);
  if (createTopic) {
    const topic = await topicStore.create(registry, createTopic[1]!, createTopic[2]!.trim());
    await selectActiveTopic(topic.topicId);
    return `已创建主题：${topic.topicId}（${topic.title}）`;
  }
  const activateCourse = /^启用(?:定制)?课程\s+(course-[\dTZ-]+)\s+--确认$/.exec(command)?.[1];
  if (activateCourse) {
    await customCourses.activate(activeTopic, activateCourse);
    return `已启用定制课程：${activateCourse}。旧计划已备份到主题笔记。\n\n${await formatCourseOverview(activeTopic)}`;
  }
  const activatePersonal = /^启用个性化计划\s+(personal-plan-[\dTZ-]+)(?:\s+--确认)?$/.exec(command)?.[1];
  if (activatePersonal) {
    await learningProfiles.activatePlan(activeTopic, activatePersonal);
    return `已启用个性化计划：${activatePersonal}`;
  }
  const activateSkill = /^启用技能草案\s+([a-z][a-z0-9-]{1,62})(?:\s+--确认)?$/.exec(command)?.[1];
  if (activateSkill) {
    await generatedSkills.activate(activeTopic, activateSkill);
    return `已启用主题 Skill：${activateSkill}`;
  }
  const activatePlan = /^启用计划\s+(plan-[\dTZ-]+)$/.exec(command)?.[1];
  if (activatePlan) return await runtime.activatePlan(activeTopic, activatePlan);
  const switchModel = /^模型切换\s+(tutor|reviewer|lab)\s+(mock|deepseek-api|codex-cli)$/.exec(command);
  if (switchModel) {
    providerRegistry.route(switchModel[1] as "tutor" | "reviewer" | "lab", switchModel[2]!);
    await routingStore.save(providerRegistry);
    return `已切换：${switchModel[1]} -> ${switchModel[2]}`;
  }
  const reminder = /^提醒设置\s+([0-2]\d:[0-5]\d)$/.exec(command)?.[1];
  if (reminder) {
    await reminders.set(activeTopic, reminder);
    return `已设置本地提醒计划：每天 ${reminder}。`;
  }
  if (command === "学习画像") {
    const profile = await learningProfiles.load(activeTopic);
    return profile ? `目标：${profile.goal}\n水平：${profile.level}\n节奏：每天 ${profile.dailyMinutes} 分钟，共 ${profile.totalDays} 天` : "尚未设置学习画像。";
  }
  if (command === "资料库") {
    const documents = library.list(activeTopic);
    return documents.length ? documents.map((document) => `${document.name}\t${document.status}\t${document.id}`).join("\n") : "当前主题没有已导入资料。";
  }
  if (command === "资料概览") {
    const documents = library.list(activeTopic);
    const profile = await learningProfiles.load(activeTopic);
    return `主题：${activeTopic}\n资料：${documents.length} 份${documents.length ? `\n${documents.map((document) => `- ${document.name}（${document.status}）`).join("\n")}` : ""}\n${profile ? "已设置学习画像；可生成个性化计划。" : "未设置学习画像。"}`;
  }
  if (command === "主题概览") {
    const [profile, reminder] = await Promise.all([learningProfiles.load(activeTopic), reminders.status(activeTopic)]);
    const documents = library.list(activeTopic);
    const progress = await runtime.handle("进度", activeTopic);
    return `主题：${registry.get(activeTopic).title}\n${progress}\n资料：${documents.length} 份\n画像：${profile ? `${profile.goal}（每天 ${profile.dailyMinutes} 分钟）` : "未设置"}\n提醒：${reminder ? `每天 ${reminder.time}（仅本地计划）` : "未设置"}`;
  }
  if (command === "技能草案列表") {
    const drafts = await generatedSkills.listDrafts(activeTopic);
    return drafts.length ? drafts.join("\n") : "当前主题没有 Skill 草案。";
  }
  if (command === "复习计划") return await runtime.createReviewPlan(activeTopic);
  const importFile = /^导入资料\s+(.+)$/.exec(command)?.[1];
  if (importFile) {
    const result = await importStagedDocument(root, library, importFile);
    await selectActiveTopic(result.topicId);
    return `导入结果：${result.status}\n主题：${result.topicId}\n文档：${result.documentId || "—"}\n分块：${result.chunks}${result.reason ? `\n原因：${result.reason}` : ""}`;
  }
  const deletePreview = /^资料删除预览\s+([a-z][a-z0-9-]*)\s+([\w-]+)$/.exec(command);
  if (deletePreview) {
    const impact = library.previewDeletion(deletePreview[1] as TopicId, deletePreview[2]!);
    return impact ? `删除影响：文档=${impact.name}，Chunk=${impact.chunks}。使用“删除资料 ${deletePreview[1]} ${deletePreview[2]} --确认”执行。` : "document_not_found";
  }
  const remove = /^删除资料\s+([a-z][a-z0-9-]*)\s+([\w-]+)\s+--确认$/.exec(command);
  if (remove) {
    const deleted = await library.deleteDocument(remove[1] as TopicId, remove[2]!, true);
    return `已删除资料：${deleted.name}，Chunk=${deleted.chunks}`;
  }
  if (command === "备份数据库") {
    const target = path.join(root, "zhixing", "db", "backups", `${new Date().toISOString().replaceAll(":", "-")}.sqlite`);
    await database.backup(target);
    return `数据库备份完成：${path.basename(target)}`;
  }
  const preview = /^备份预览\s+([^\s]+)$/.exec(command)?.[1];
  if (preview) {
    const result = await previewBackup(backupFile(preview));
    return `备份预览：${preview}，字节=${result.bytes}，migrations=${result.migrations}`;
  }
  const restore = /^恢复数据库\s+([^\s]+)\.sqlite\s+--确认$/.exec(command)?.[1];
  if (restore) {
    await restoreDatabaseSafely(backupFile(`${restore}.sqlite`));
    return "数据库恢复完成，已重新打开数据库连接。";
  }
  const canonicalProfile = /^设置学习画像\s+(.+?)\s+--水平\s+(.+?)\s+--每天\s+(\d+)\s+--周期\s+(\d+)$/.exec(command);
  if (canonicalProfile) {
    await learningProfiles.save(activeTopic, { goal: canonicalProfile[1]!.trim(), level: canonicalProfile[2]!.trim(), dailyMinutes: Number(canonicalProfile[3]), totalDays: Number(canonicalProfile[4]) });
    return `已保存学习画像：${activeTopic}（${canonicalProfile[3]} 分钟/天，${canonicalProfile[4]} 天）`;
  }
  if (command === "生成个性化计划") return `已生成个性化计划草案：${await learningProfiles.proposePlan(activeTopic)}`;
  if (command === "生成定制课程") {
    const profile = await learningProfiles.load(activeTopic); if (!profile) throw new Error("learning_profile_required");
    return `已生成定制课程草案：${await customCourses.propose(activeTopic, registry.get(activeTopic).title, profile)}`;
  }
  const generateSkill = /^生成技能草案\s+([a-z][a-z0-9-]{1,62})$/.exec(command)?.[1];
  if (generateSkill) { const profile = await learningProfiles.load(activeTopic); if (!profile) throw new Error("learning_profile_required"); await generatedSkills.createDraft(activeTopic, generateSkill, profile); return `已生成本地 Skill 草案：${generateSkill}`; }
  const naturalProfile = /^设置学习画像\s+([a-z0-9][a-z0-9-]*)\s+目标\s+(.+?)\s+水平\s+(.+?)\s+每日\s+(\d+)分钟\s+总计\s+(\d+)天$/.exec(command);
  if (naturalProfile) {
    const topic = registry.list().find((item) => item.topicId === naturalProfile[1]);
    if (!topic) throw new Error(`topic_not_found: ${naturalProfile[1]}`);
    await selectActiveTopic(topic.topicId);
    await learningProfiles.save(activeTopic, { goal: naturalProfile[2]!.trim(), level: naturalProfile[3]!.trim(), dailyMinutes: Number(naturalProfile[4]), totalDays: Number(naturalProfile[5]) });
    return `已保存学习画像：${activeTopic}（${naturalProfile[4]} 分钟/天，${naturalProfile[5]} 天）`;
  }
  const deterministic = await runtime.handle(command, activeTopic);
  if (!deterministic.startsWith("支持：")) return deterministic;
  throw new Error("conversation_action_not_implemented: 请使用明确 CLI 命令执行该草案。");
}

function backupFile(name: string): string {
  if (path.basename(name) !== name || !name.endsWith(".sqlite")) throw new Error("denied: 非法备份文件名");
  return path.join(root, "zhixing", "db", "backups", name);
}

function formatSearch(topicId: TopicId, query: string): string {
  if (!query.trim()) return "insufficient_evidence：查询不能为空。";
  const results = library.search(topicId, query);
  if (results.length === 0) return "insufficient_evidence：当前主题资料中没有足够证据。";
  const evidence = results.slice(0, 3).map((result, index) => {
    const location = result.citation.pageNumber ? `page=${result.citation.pageNumber}` : `anchor=${result.citation.anchor ?? "root"}`;
    const snippet = result.text.replace(/\s+/g, " ").trim();
    return `${index + 1}. ${snippet.length > 360 ? `${snippet.slice(0, 360)}…` : snippet}\n   来源：${result.citation.documentName}#${location}`;
  });
  return `基于当前主题资料的检索证据：\n${evidence.join("\n")}`;
}

async function run(command: string, topicId: TopicId, action: (lifecycle: import("./run-context.js").RunContext, signal: AbortSignal) => Promise<string>): Promise<string> {
  const actionId = ({
    create_topic: "topic.create", provider_list: "provider.list", provider_status: "provider.status", update_model_routing: "provider.route",
    guided_start_day: "learning.start_day", guided_learning_task: "learning.start_task", next_step: "learning.progress",
    import_document: "library.import", delete_document: "library.delete", restore_backup: "database.restore", write_memory: "memory.write",
  } as Record<string, string>)[command] ?? command;
  const result = await runs.run(topicId, command, async (signal, lifecycle) => action(lifecycle, signal), actionId);
  syncServer?.publish({ topicId, type: "progress", payload: { topicId, command, at: new Date().toISOString() } });
  return result;
}

let releaseShutdown: (() => void) | undefined;
const shutdown = new Promise<void>((resolve) => { releaseShutdown = resolve; });
process.on("SIGINT", () => { void runs.cancel(); releaseShutdown?.(); });
process.on("SIGTERM", () => { void runs.cancel(); releaseShutdown?.(); });

function presentError(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown_error";
  if (message.startsWith("provider_timeout")) return "模型暂时没有及时响应。请保持当前 REPL，稍后重试；连接建立后后续回答会更快。";
  if (message === "run_in_progress") return "上一项操作仍在处理。请等待结果，或按 Ctrl-C 取消后再试。";
  if (message.includes("confirmation_required") || message.includes("course_activation_confirmation_required")) return `该操作会改变已有学习状态（${message}）。请核对草案后使用“直接运行 --确认”。`;
  if (message.startsWith("learning_profile_required")) return "还缺少学习画像。请告诉我你的目标、基础、每天可投入时间和周期。";
  return `操作未完成：${message}`;
}

try {
  if (input) {
    console.log(await execute(input));
    if (syncServer) await shutdown;
  }
  else {
    const reader = createInterface({ input: stdin, output: stdout });
    for (;;) {
      let line: string;
      try { line = await reader.question("知行> "); }
      catch { break; }
      if (["退出", "exit", "quit"].includes(line.trim())) break;
      try { console.log(await execute(line)); }
      catch (error) { console.error(presentError(error)); }
    }
    reader.close();
  }
} catch (error) {
  console.error(presentError(error));
  process.exitCode = 1;
} finally {
  await syncServer?.close();
  database.close();
}
