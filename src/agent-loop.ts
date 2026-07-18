import { LoopGuard, type LoopStopReason } from "./loop-guard.js";
export class AgentLoop { readonly #guard: LoopGuard; constructor(maxTurns = 6) { this.#guard = new LoopGuard(maxTurns); } turn(): LoopStopReason | undefined { return this.#guard.nextTurn(); } tool(name: string, input: unknown): LoopStopReason | undefined { return this.#guard.recordToolCall(name, input); } }
