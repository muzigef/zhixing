import type { AgentExecutor, AgentExecutionResult } from "./agent-executor.js";

export interface NativeCommand { executable: string; args: string[]; input: string; cwd: string; environment: NodeJS.ProcessEnv; subscriptionStatus?: boolean; }
export type NativeRunner = (command: NativeCommand, signal: AbortSignal, onLine: (line: string) => void) => Promise<void>;
export type NativeContext = Omit<NativeCommand, "args" | "input">;
/** Trusted in-process adapter, never loaded from user JSON or from a model response.
 * Each adapter owns official auth, version/isolation checks and vendor event decoding.
 * Common lifetime, input/output bounds and business state remain in the host. */
export interface NativeRuntimeAdapter {
  readonly environment?: Readonly<NodeJS.ProcessEnv>;
  model(environment: NodeJS.ProcessEnv): string;
  probe(command: NativeContext, runner: NativeRunner, signal: AbortSignal, help: string): Promise<{ available: boolean; reason: string }>;
  execute(command: NativeContext, runner: NativeRunner, request: Parameters<AgentExecutor["execute"]>[0], model: string, signal: AbortSignal, onText?: (text: string) => void): Promise<AgentExecutionResult>;
}
