import { z } from "zod";

export type ActionRisk = "read" | "write" | "destructive" | "provider";
export interface RegisteredAction {
  readonly id: string;
  readonly risk: ActionRisk;
  readonly confirmationRequired: boolean;
  readonly confirmed: boolean;
  readonly input: unknown;
}

type Definition = { id: string; risk: ActionRisk; confirmationRequired?: boolean; pattern: RegExp; input: (match: RegExpExecArray) => unknown };
const topicId = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);

/** Declarative command metadata; handlers stay behind the control-plane boundary. */
const definitions: readonly Definition[] = [
  { id: "topic.list", risk: "read", pattern: /^主题列表$/, input: () => ({}) },
  { id: "topic.select", risk: "write", pattern: /^学习\s+(.+)$/, input: (m) => ({ topic: m[1]!.trim() }) },
  { id: "topic.create", risk: "write", pattern: /^创建主题\s+([a-z0-9][a-z0-9-]*)\s+(.+)$/, input: (m) => ({ topicId: topicId.parse(m[1]), title: m[2]!.trim() }) },
  { id: "learning.start_day", risk: "write", pattern: /^开始第\s*(\d+)\s*天$/, input: (m) => ({ day: Number(m[1]) }) },
  { id: "learning.start_task", risk: "write", pattern: /^开始任务$/, input: () => ({}) },
  { id: "learning.progress", risk: "read", pattern: /^(进度|全部进度|下一步|继续|主题概览)$/, input: (m) => ({ view: m[1] }) },
  { id: "learning.agent", risk: "provider", pattern: /^学习助手\s+([\s\S]+)$/, input: (m) => ({ question: m[1]!.trim() }) },
  { id: "evidence.submit", risk: "write", pattern: /^提交证据\s+(D\d{2})\s+(implementation|testOutput|failureCase|reflection|testScript)\s+([\s\S]+)$/, input: (m) => ({ dayId: m[1], kind: m[2], text: m[3] }) },
  { id: "evidence.validate", risk: "write", pattern: /^运行测试\s+(D\d{2})$/, input: (m) => ({ dayId: m[1] }) },
  { id: "evidence.list", risk: "read", pattern: /^证据列表\s+(D\d{2})$/, input: (m) => ({ dayId: m[1] }) },
  { id: "evidence.review", risk: "write", pattern: /^检查\s+(D\d{2})(?:\s+--(?:实现|测试|失败|复盘))*$/, input: (m) => ({ dayId: m[1] }) },
  { id: "library.import", risk: "write", pattern: /^导入资料\s+(.+)$/, input: (m) => ({ source: m[1]!.trim() }) },
  { id: "library.delete", risk: "destructive", confirmationRequired: true, pattern: /^删除资料\s+([a-z0-9][a-z0-9-]*)\s+([\w-]+)$/, input: (m) => ({ topicId: topicId.parse(m[1]), documentId: m[2] }) },
  { id: "database.restore", risk: "destructive", confirmationRequired: true, pattern: /^恢复数据库\s+([^\s]+)$/, input: (m) => ({ backup: m[1] }) },
  { id: "provider.route", risk: "provider", confirmationRequired: true, pattern: /^模型切换\s+(tutor|reviewer|lab)\s+(mock|deepseek-api|codex-cli|pi-codex)$/, input: (m) => ({ role: m[1], provider: m[2] }) },
  { id: "memory.write", risk: "write", confirmationRequired: true, pattern: /^记住\s+(.+)$/, input: (m) => ({ content: m[1]!.trim() }) },
] as const;

export class ActionRegistry {
  resolve(command: string): RegisteredAction | undefined {
    const confirmed = /\s+--确认$/.test(command.trim());
    const normalised = command.trim().replace(/\s+--确认$/, "");
    for (const definition of definitions) {
      const match = definition.pattern.exec(normalised);
      if (match) return { id: definition.id, risk: definition.risk, confirmationRequired: Boolean(definition.confirmationRequired), confirmed, input: definition.input(match) };
    }
    return undefined;
  }
}
