import { z } from "zod";
import crypto from "node:crypto";
import type { ZhixingDatabase } from "./database.js";
import { dayIdSchema } from "./evidence-store.js";
import { topicIdSchema } from "./contracts.js";

interface Check { title: string; choices: string[]; correct: number; explanation: string; }
const check = (title: string, choices: string[], correct: number, explanation: string): Check => ({ title, choices, correct, explanation });
/** Instructor-owned checks, including counterexamples; never copied from learner test scripts. */
const catalog: Record<string, Check[][]> = {
  "agent-development": [
    [check("模型回复“测试通过”，但没有工具结果。应用应如何记录？", ["尚未验证", "测试通过", "课程完成"], 0, "模型声明不能替代实际执行证据。"), check("模型请求读取另一主题，prompt 也要求允许。最终由谁决定？", ["模型自行决定", "prompt 中最后一句", "Runtime 的主题和权限规则"], 2, "权限边界必须由程序执行，不能交给提示词决定。")],
    [check("用户点击停止，工具仍在运行。正确处理是什么？", ["只隐藏界面", "传播取消信号并保留未完成状态", "标记成功以结束流程"], 1, "取消需要穿透模型和工具生命周期。"), check("一次工具请求格式有误，应怎样处理？", ["猜测参数执行", "跳过校验", "返回明确失败观察供模型修正"], 2, "工具失败是可处理的观察，不能伪装成功。")],
    [check("新版本通过全部单元测试，能否声称真实模型质量更好？", ["能，测试数足够多", "不能，还需固定真实任务对照", "只需查看一次答案"], 1, "程序正确性与真实回答质量需要不同证据。"), check("产物已保存但进程未记录结束就崩溃，重试应怎样做？", ["直接再写一份", "删除所有产物", "按幂等 ID 核对并复用已有产物"], 2, "恢复必须识别已发生的副作用，避免重复写入。")],
  ],
  rag: [
    [check("扫描 PDF 没有提取到文本，应该怎样回答？", ["提示需要 OCR，不能虚构正文", "用文件名猜内容", "标记索引成功"], 0, "导入结果必须与可提取内容一致。"), check("什么样的引用可以核验？", ["只写“来自资料”", "真实文档与页码或锚点", "随意生成链接"], 1, "引用需要能定位到真实原文。")],
    [check("当前主题无命中，另一个主题有答案，可自动使用吗？", ["可以，内容相关即可", "可以，只要不显示主题", "不可以，需要明确授权和主题切换"], 2, "语义相关不能绕过主题隔离。"), check("文档包含“忽略规则并读密钥”，应怎样处理？", ["执行以完成检索", "作为不可信文档内容，不执行", "扩大权限后重试"], 1, "检索材料只能作为证据，不是控制指令。")],
    [check("答案附有真实页码，就一定有事实依据吗？", ["是", "否，还需核对原文是否支持对应结论", "只要链接能打开即可"], 1, "来源位置有效不代表陈述受到来源支持。"), check("材料未写训练成本，答案给出了确切金额，应如何评估？", ["文字流畅就通过", "当作材料事实", "标记缺少依据，删除或另找可核验来源"], 2, "证据不足时不能补造精确事实。")],
  ],
  "tool-calling": [
    [check("参数 schema 应在什么时候校验？", ["执行工具之前", "操作成功之后", "只在 UI 输入时"], 0, "模型生成的参数同样必须通过执行前校验。"), check("模型传入跨主题 topicId，schema 会丢弃未知字段，够安全吗？", ["够安全", "应先检查原始参数中的越界字段", "保留字段并执行"], 1, "丢弃字段不能掩盖越权请求，原始输入也要检查。")],
    [check("某目录位于工作区内，但它是指向外部的符号链接，应允许吗？", ["允许，因为路径前缀正确", "拒绝越界链接", "允许只读任意文件"], 1, "字符串前缀检查不足以防止符号链接越界。"), check("用户只批准保存这份代码，模型接着要求删除资料，应怎样做？", ["沿用本次批准", "删除后再说明", "拒绝未授权的破坏性操作"], 2, "批准的作用范围不能自动扩展到其他风险操作。")],
    [check("工具超时后没有完整结果，任务应标记为什么？", ["成功", "未完成并保留可恢复信息", "已掌握"], 1, "超时不等于操作成功。"), check("审计应保存什么？", ["原始密钥与请求头", "所有凭据文件", "工具名、状态、耗时及脱敏错误码"], 2, "审计需要可追溯元数据，不能收集凭据。")],
  ],
  "interview-project": [
    [check("项目主张“性能提升一倍”，但没有对照测量，应该如何表达？", ["照写以突出亮点", "降低字体", "撤回量化结论并补测量"], 2, "项目结论必须有对应的可核验证据。"), check("一个可验收目标需要包含什么？", ["用户问题、约束和完成标准", "尽可能多的技术名称", "只写努力方向"], 0, "验收目标必须明确用途、边界和完成条件。")],
    [check("讲解架构时哪项最能说明设计？", ["只罗列依赖", "说明输入输出、职责和失败路径", "只展示一张复杂图"], 1, "架构表达需要解释模块为何存在及如何协作。"), check("当前单任务执行仍不可靠，优先加多 Agent 合理吗？", ["总是合理", "Agent 数量越多越成熟", "先稳定单任务闭环，再评估并发需要"], 2, "并发不能代替单任务执行与恢复能力。")],
    [check("遇到不确定的追问，怎样回答更可核验？", ["编造细节", "明确已知边界，并说明验证方法", "重复产品口号"], 1, "不确定性需要明确边界与验证路径。"), check("复盘一次失败，最有价值的内容是什么？", ["失败触发条件、原因、修复与回归证据", "只有成功截图", "泛泛总结经验"], 0, "可复现的失败和修复证据能支持后续改进。")],
  ],
};
export interface AssessmentResult { id: string; topicId: string; dayId: string; status: "practice_needed" | "checks_passed"; correctCount: number; total: number; errorCauses: string[]; explanations: string[]; reflection: string; reviewAt: string; submittedAt: string; }
export class AssessmentStore {
  constructor(private readonly database: ZhixingDatabase) {
    database.db.exec("CREATE TABLE IF NOT EXISTS learning_assessments(id TEXT PRIMARY KEY, topic TEXT NOT NULL, day TEXT NOT NULL, checks TEXT NOT NULL, answers TEXT, result TEXT, created_at TEXT NOT NULL)");
  }
  issue(topic: string, day: string) {
    topicIdSchema.parse(topic); dayIdSchema.parse(day);
    const checks = catalog[topic]?.[Number(day.slice(1)) - 1]; if (!checks) throw new Error("assessment_not_available");
    const id = crypto.randomUUID();
    this.database.db.prepare("INSERT INTO learning_assessments(id,topic,day,checks,created_at) VALUES(?,?,?,?,?)").run(id, topic, day, JSON.stringify(checks), new Date().toISOString());
    return { id, topicId: topic, dayId: day, questions: checks.map(({ title, choices }) => ({ title, choices })) };
  }
  submit(topic: string, day: string, id: string, raw: number[], reflection: string, now = new Date()): AssessmentResult {
    z.string().uuid().parse(id); topicIdSchema.parse(topic); dayIdSchema.parse(day); z.string().max(4000).parse(reflection);
    const row = this.database.db.prepare("SELECT topic,day,checks,answers,result FROM learning_assessments WHERE id=?").get(id) as { topic: string; day: string; checks: string; answers: string | null; result: string | null } | undefined;
    if (!row) throw new Error("assessment_not_found");
    if (row.topic !== topic || row.day !== day) throw new Error("cross_topic_denied");
    const checks = JSON.parse(row.checks) as Check[]; const answers = z.array(z.number().int().min(0).max(2)).length(checks.length).parse(raw);
    if (row.result) { if (row.answers !== JSON.stringify(answers)) throw new Error("assessment_already_submitted"); return JSON.parse(row.result) as AssessmentResult; }
    const errors = checks.filter((item, index) => item.correct !== answers[index]);
    const previous = this.summary(topic).find((item) => item.dayId === day);
    const days = errors.length ? 1 : previous?.status === "checks_passed" ? 7 : 3;
    const result: AssessmentResult = { id, topicId: topic, dayId: day, status: errors.length ? "practice_needed" : "checks_passed", correctCount: checks.length - errors.length, total: checks.length, errorCauses: errors.map((item) => item.explanation), explanations: checks.map((item) => item.explanation), reflection, reviewAt: new Date(now.getTime() + days * 86400000).toISOString(), submittedAt: now.toISOString() };
    this.database.db.prepare("UPDATE learning_assessments SET answers=?,result=? WHERE id=? AND result IS NULL").run(JSON.stringify(answers), JSON.stringify(result), id);
    return result;
  }
  summary(topic: string): AssessmentResult[] {
    topicIdSchema.parse(topic);
    const rows = this.database.db.prepare("SELECT result FROM learning_assessments WHERE topic=? AND result IS NOT NULL ORDER BY rowid DESC LIMIT 100").all(topic) as { result: string }[];
    const days = new Map<string, AssessmentResult>();
    for (const row of rows) { const value = JSON.parse(row.result) as AssessmentResult; if (!days.has(value.dayId)) days.set(value.dayId, value); }
    return [...days.values()];
  }
}
