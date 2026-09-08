import { z } from "zod/v4";

export const modelPhaseSchema = z.enum(["initializing", "requesting", "waiting", "responding", "tool_preparing", "finishing"]);
export type ModelPhase = z.infer<typeof modelPhaseSchema>;
export const piTransportSchema = z.enum(["sse", "auto"]);
const milliseconds = z.number().finite().nonnegative().max(300_000);
/** Worker-local timings. requestMs includes auth resolution, network and remote processing. */
export const workerTimingSchema = z.object({
  transport: piTransportSchema,
  startupMs: milliseconds,
  requestMs: milliseconds,
  firstEventMs: milliseconds.optional(),
  firstTextMs: milliseconds.optional(),
}).strict();
/** Adapter adds selection, complete process lifetime and post-done cleanup. */
export const modelTimingSchema = workerTimingSchema.extend({
  selectionMs: milliseconds,
  totalMs: milliseconds,
  processTailMs: milliseconds,
}).strict();
export type ModelTiming = z.infer<typeof modelTimingSchema>;
export const modelPhaseLabels: Record<ModelPhase, string> = {
  initializing: "准备模型", requesting: "正在请求模型", waiting: "等待模型内容",
  responding: "正在回答", tool_preparing: "模型正在准备工具调用", finishing: "正在完成本轮回答",
};
