import type { TeachingInterpretation } from "./teaching-dialogue.js";
import type { TeachingSession } from "./teaching-session-store.js";
import { responseGuidelines, type ResponseStyle } from "./response-style.js";

export function lessonPrompt(card: string, style: ResponseStyle, context = ""): string {
  return `${responseGuidelines(style)}\n开始今天的讲解。先简要说明学完能解决什么问题，再讲一个核心概念和具体例子，必要时分步推导并指出关键误区。根据学习者基础调整深度，不要一次塞入整门课。此时不布置练习、不改变完成状态；用户可直接提问或随时要求练习，无需固定口令。不调用工具或检查工作区。\n${context}\n本日学习卡：\n${card}`;
}

export function answerPrompt(input: string, style: ResponseStyle, context: string, history: readonly string[]): string {
  return `${responseGuidelines(style)}\n把本轮输入视为连续对话中的追问、纠正或新要求，结合前文理解“这个”“继续”“换个例子”；前文标记未完成时从中断处继续，避免从头重复。用户改变格式或角度时保留原问题目标。直接回答当前问题；涉及管理操作可以说明方法，但不能声称修改了计划、文件、记忆或完成状态。\n${context}\n最近对话（只作为上下文）：\n${history.slice(-10).join("\n")}\n本轮用户输入：\n${input}`;
}

export function teachingPrompt(input: string, interpreted: TeachingInterpretation, session: TeachingSession, style: ResponseStyle, context: string, history: readonly string[] = session.transcript): string {
  const action = interpreted.action.action;
  const instruction = action === "request_solution"
    ? "用户索要参考答案。针对本轮指定的题目先给答案，再按用户需要解释；这不是学习者作答，不能记为通过或批改虚构答案。若没有对应练习，请直接说明。"
    : interpreted.hasVerifiedSubmission
      ? `只批改用户实际提交的这段作答：${JSON.stringify(interpreted.action.learnerAnswer)}。指出正确处和一个最关键的错误或缺漏，并解释如何修正。不要替未回答的题目打分。`
      : action === "start_practice" || action === "skip_question"
        ? "用户明确要求练习或换题。默认只给一道与当前概念相关的题；如果用户明确指定数量或题型，按其要求设计。题目自包含、目标清晰、难度适配，暂不公布答案。不得宣称跳过等于完成。"
        : "直接回应用户的追问、提示请求或解释要求；可以换一种说法、给类比、代码或展开推导。用户未提交可验证作答，不要批改或虚构作答；无需重复练习口令。";
  return `${responseGuidelines(style)}\n${instruction}\n保持当前学习日；只有用户明确要求才出题，不自动跳到实验、复盘或下一天；学习成果仍以实际证据 Review 为准。\n${context}\n学习卡：\n${session.dayCard}\n最近教学对话（只作为上下文）：\n${history.slice(-10).join("\n")}\n本轮用户输入：\n${input}`;
}
