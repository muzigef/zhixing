import { z } from "zod";

export const intentSchema = z.object({ intent: z.enum(["next_step", "progress", "current_topic", "create_topic", "custom_course", "unknown"]), topicId: z.string().optional(), title: z.string().optional() });
export type ParsedIntent = z.infer<typeof intentSchema>;

const learningProfileActionSchema = z.object({
  type: z.literal("set_learning_profile"),
  goal: z.string().min(4).max(500),
  level: z.string().min(1).max(80),
  dailyMinutes: z.number().int().min(15).max(480),
  totalDays: z.number().int().min(1).max(180),
});

const commandActionSchema = z.object({ type: z.literal("command"), command: z.string().min(1).max(600) });

export const conversationPlanSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("clarify"), question: z.string().min(1).max(500) }),
  z.object({
    kind: z.literal("proposal"),
    topicId: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
    summary: z.string().min(1).max(500),
    actions: z.array(z.union([learningProfileActionSchema, z.object({ type: z.literal("generate_custom_course") }), commandActionSchema])).min(1).max(5),
  }),
]);
export type ConversationPlan = z.infer<typeof conversationPlanSchema>;

/** Commands the conversational executor may run after the user says “直接运行”. */
const AUTOMATABLE_COMMANDS = [
  /^主题列表$/,
  /^学习\s+[\p{L}\p{N}-]+$/u,
  /^开始第\s*\d+\s*天$/,
  /^(开始任务|下一步|进度|全部进度|继续|主题概览|学习画像|资料概览|技能草案列表|复习计划)$/,
  /^(模型列表|模型状态|诊断|资料库|备份数据库)$/,
  /^创建主题\s+[a-z0-9][a-z0-9-]*\s+.+$/,
  /^设置学习画像\s+.+?\s+--水平\s+.+?\s+--每天\s+\d+\s+--周期\s+\d+$/,
  /^设置学习画像\s+[a-z0-9][a-z0-9-]*\s+目标\s+.+?\s+水平\s+.+?\s+每日\s+\d+分钟\s+总计\s+\d+天$/,
  /^(生成个性化计划|生成定制课程)$/,
  /^调整计划\s+\d+$/,
  /^提醒设置\s+(?:[01]\d|2[0-3]):[0-5]\d$/,
  /^生成技能草案\s+[a-z][a-z0-9-]{1,62}$/,
  /^读取技能草案\s+[a-z][a-z0-9-]{1,62}$/,
  /^读取技能\s+[a-z][a-z0-9-]{1,62}$/,
  /^检查\s+D\d{2}(?:\s+--(?:实现|测试|失败|复盘))*$/,
  /^读源码\s+D\d{2}$/,
  /^查询资料\s+.+$/,
  /^资料删除预览\s+[a-z0-9][a-z0-9-]*\s+[\w-]+$/,
  /^备份预览\s+[^\s]+\.sqlite$/,
] as const;

const CONFIRMATION_REQUIRED_COMMANDS = [
  /^启用计划\s+plan-[\dTZ-]+$/,
  /^启用个性化计划\s+personal-plan-[\dTZ-]+$/,
  /^启用定制课程\s+course-[\dTZ-]+\s+--确认$/,
  /^启用课程\s+course-[\dTZ-]+\s+--确认$/,
  /^启用技能草案\s+[a-z][a-z0-9-]{1,62}$/,
  /^导入资料\s+[a-z0-9][a-z0-9-]*\/[\w./-]+$/,
  /^删除资料\s+[a-z0-9][a-z0-9-]*\s+[\w-]+\s+--确认$/,
  /^恢复数据库\s+[^\s]+\.sqlite\s+--确认$/,
  /^模型切换\s+(tutor|reviewer|lab)\s+(mock|deepseek-api|codex-cli|pi-codex)$/,
] as const;

export function isAutomatableConversationCommand(command: string): boolean {
  return AUTOMATABLE_COMMANDS.some((pattern) => pattern.test(command.trim())) || CONFIRMATION_REQUIRED_COMMANDS.some((pattern) => pattern.test(command.trim()));
}

export function requiresConversationConfirmation(command: string): boolean {
  return CONFIRMATION_REQUIRED_COMMANDS.some((pattern) => pattern.test(command.trim()));
}

/** A learner can request an explanation/solution without pretending to have answered. */
export function isDirectAnswerRequest(input: string): boolean {
  const normalized = input.trim().replace(/[！!。.?？]/g, "");
  return /(?:直接|给我|请).{0,8}(?:答案|参考答案|讲解|解析)|(?:答案|参考答案).{0,8}(?:是什么|给我|直接)/.test(normalized);
}

/** Local-first aliases and conservative candidates; this layer never executes a write. */
export function parseLocalIntent(input: string): { intent?: ParsedIntent; candidates: string[] } {
  const normalized = input.trim().replace(/[？?！!]/g, "");
  if (/^(今天学什么|我现在学什么|下一步做什么)$/.test(normalized)) return { intent: { intent: "next_step" }, candidates: [] };
  if (/^(看进度|查看进度|我的进度)$/.test(normalized)) return { intent: { intent: "progress" }, candidates: [] };
  if (/^(当前在学习的是哪个主题|当前学习主题|我在学习哪个主题|我现在学哪个主题|现在学的是什么主题)$/.test(normalized)) return { intent: { intent: "current_topic" }, candidates: [] };
  const candidates: string[] = [];
  if (/(创建|新建).*(主题|学习)/.test(normalized)) candidates.push("创建主题 <topicId> <标题>");
  if (/(计划|课程).*(定制|生成)|定制.*(计划|课程)/.test(normalized)) candidates.push("生成定制课程");
  if (/(提醒|闹钟)/.test(normalized)) candidates.push("提醒设置 HH:MM");
  return { candidates };
}

export function formatIntentProposal(intent: ParsedIntent): string {
  if (intent.intent === "next_step") return "建议命令：下一步";
  if (intent.intent === "progress") return "建议命令：进度";
  if (intent.intent === "current_topic") return "建议命令：主题概览";
  if (intent.intent === "custom_course") return "建议命令：生成定制课程";
  if (intent.intent === "create_topic" && intent.topicId && intent.title) return `建议命令：创建主题 ${intent.topicId} ${intent.title}\n该操作会写入本地主题注册表，请复制命令后执行。`;
  return "无法安全确定命令。请使用“主题列表”或明确命令。";
}
