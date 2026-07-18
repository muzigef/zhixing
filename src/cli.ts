import crypto from "node:crypto";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { AuditLogger } from "./audit.js";
import { RunManager } from "./run-manager.js";
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

assertSupportedNodeVersion();
const root = process.env.ZHIXING_ROOT ? path.resolve(process.env.ZHIXING_ROOT) : path.resolve(import.meta.dirname, "../..");
const policy = new PathPolicy(root);
const registry = createDefaultTopicRegistry();
const runtime = new LearningRuntime(registry, policy);
let database = new ZhixingDatabase(path.join(root, "zhixing", "db", "zhixing.sqlite"));
let library = new DocumentLibrary(database, policy);
const audit = new AuditLogger(policy);
const runs = new RunManager(audit);
const providerRegistry = new ProviderRegistry();
const mockProvider = new MockModelClient();
const keychain = new MacOSKeychainSecretStore();
providerRegistry.register({ id: "mock", client: mockProvider, health: async () => "healthy" });
providerRegistry.register({ id: "deepseek-api", client: new DeepSeekClient(keychain), health: async () => await keychain.get("keychain:zhixing/deepseek-api") ? "healthy" : "unavailable" });
providerRegistry.register({ id: "codex-cli", client: new CodexCliClient(), health: async () => process.env.ZHIXING_ALLOW_LIVE_PROVIDER === "1" ? "unknown" : "unavailable" });
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
let syncServer: LocalSyncServer | undefined;
const rawArguments = process.argv.slice(2);
const topicArgumentIndex = rawArguments.indexOf("--topic");
const requestedTopic = topicArgumentIndex >= 0 ? rawArguments[topicArgumentIndex + 1] : undefined;
let activeTopic: TopicId = registry.list().find((topic) => topic.topicId === requestedTopic)?.topicId ?? "agent-development";
const argumentsWithoutRepl = rawArguments.filter((argument, index) => argument !== "--repl" && argument !== "--topic" && (topicArgumentIndex < 0 || index !== topicArgumentIndex + 1));
const input = argumentsWithoutRepl.join(" ");

async function execute(line: string): Promise<string> {
  const command = line.trim();
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
    if (topic) activeTopic = topic.topicId;
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
  const switchModel = /^模型切换\s+(tutor|reviewer|lab)\s+([a-z][a-z0-9-]*)$/.exec(command);
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
  const activatePersonalPlan = /^启用个性化计划\s+(personal-plan-[\dTZ-]+)$/.exec(command)?.[1];
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
  const activateSkillDraft = /^启用技能草案\s+([a-z][a-z0-9-]{1,62})$/.exec(command)?.[1];
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
    activeTopic = result.topicId;
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
  const coaching = /^学习建议(\s+--允许外发)?$/.exec(command);
  if (coaching) return run("learning_guidance", activeTopic, async (lifecycle, signal) => {
    const profile = await learningProfiles.load(activeTopic);
    if (!profile) return "请先设置学习画像，再生成建议。";
    const documents = library.list(activeTopic);
    if (!coaching[1]) return `本地建议\n目标：${profile.goal}\n今天安排：${profile.dailyMinutes} 分钟，围绕当前 Day 完成一个练习、一个失败案例和一次复盘。\n资料状态：${documents.length} 份已导入。\n如需由当前 tutor 模型生成建议（只发送画像和资料名称，不发送原文），使用“学习建议 --允许外发”。`;
    const prompt = `你是学习教练。基于以下仅含元数据的学习画像和资料清单，给出一个 ${profile.dailyMinutes} 分钟学习会话：一个目标、一个练习、一个失败案例、一个复盘问题。不得声称完成学习日，不得要求读取未提供的资料。\n主题：${activeTopic}\n目标：${profile.goal}\n水平：${profile.level}\n周期：${profile.totalDays} 天\n资料名称：${documents.map((document) => document.name).join("、") || "无"}`;
    const result = await collectInvocation(providers, { role: "tutor", providerId: "routed", prompt, containsUserMaterials: true, confirmed: true, onAudit: (record) => { void lifecycle.model(record.providerId, record.role, record.durationMs, record.status); } }, signal);
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
    database.close();
    await restoreBackup(backupFile(restoreBackupName), path.join(root, "zhixing", "db", "zhixing.sqlite"), true);
    database = new ZhixingDatabase(path.join(root, "zhixing", "db", "zhixing.sqlite"));
    library = new DocumentLibrary(database, policy);
    return "数据库恢复完成，已重新打开数据库连接。";
  });
  const answer = /^资料问答\s+(.+?)(\s+--允许外发)?$/.exec(command);
  const answerQuestion = answer?.[1];
  if (answerQuestion) return run("grounded_answer", activeTopic, async (lifecycle, signal) => {
    const { topicId, question } = resolveTopicQuery(answerQuestion);
    const evidence = library.search(topicId, question);
    if (!answer?.[2]) return formatSearch(topicId, question);
    const workflowSkills = (await skills.list(topicId)).map((skill) => ({ name: skill.name, description: skill.description }));
    return answerFromEvidence(providers, question, evidence, true, signal, (providerId, role, durationMs, status) => { void lifecycle.model(providerId, role, durationMs, status); }, undefined, workflowSkills);
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
  return run("learning_command", activeTopic, () => runtime.handle(command, activeTopic));
}

function resolveTopicQuery(value: string): { topicId: TopicId; question: string } {
  const [candidate, ...rest] = value.trim().split(/\s+/);
  const explicitTopic = candidate ? registry.list().find((topic) => topic.topicId === candidate)?.topicId : undefined;
  return { topicId: explicitTopic ?? activeTopic, question: explicitTopic ? rest.join(" ") : value };
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
  const result = await runs.run(topicId, command, async (signal, lifecycle) => action(lifecycle, signal));
  syncServer?.publish({ topicId, type: "progress", payload: { topicId, command, at: new Date().toISOString() } });
  return result;
}

let releaseShutdown: (() => void) | undefined;
const shutdown = new Promise<void>((resolve) => { releaseShutdown = resolve; });
process.on("SIGINT", () => { void runs.cancel(); releaseShutdown?.(); });
process.on("SIGTERM", () => { void runs.cancel(); releaseShutdown?.(); });

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
      catch (error) { console.error(`错误：${error instanceof Error ? error.message : "unknown_error"}`); }
    }
    reader.close();
  }
} catch (error) {
  console.error(`错误：${error instanceof Error ? error.message : "unknown_error"}`);
  process.exitCode = 1;
} finally {
  await syncServer?.close();
  database.close();
}
