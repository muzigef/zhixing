export type LoopStopReason = "max_turns" | "repeated_tool_call";

/** Enforces bounded model/tool iterations independently of provider behavior. */
export class LoopGuard {
  readonly #seen = new Set<string>();
  #turns = 0;

  constructor(private readonly maxTurns = 6) {}

  nextTurn(): LoopStopReason | undefined {
    this.#turns += 1;
    return this.#turns > this.maxTurns ? "max_turns" : undefined;
  }

  recordToolCall(name: string, input: unknown): LoopStopReason | undefined {
    const key = `${name}:${JSON.stringify(input, (_key, value: unknown) => {
      // Object key order is not part of a tool's meaning; array order is.
      if (value && typeof value === "object" && !Array.isArray(value)) return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
      return value;
    })}`;
    if (this.#seen.has(key)) return "repeated_tool_call";
    this.#seen.add(key);
    return undefined;
  }
}
