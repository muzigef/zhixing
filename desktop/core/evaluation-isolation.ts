/** Live evaluator can read configured providers, but cannot mutate user settings or run arbitrary chat/tools. */
export function evaluationCommandAllowed(type: string): boolean {
  return ["boot", "sessions", "new", "load", "native-agent-status", "check-api", "team-evaluate", "provider-benchmark", "team-evaluation-status", "diagnostics", "stop"].includes(type);
}
