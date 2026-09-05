/** Small streaming terminal renderer. Non-TTY output retains portable Markdown. */
export class TerminalMarkdownWriter {
  private pending = "";
  private fence: { marker: string; length: number } | undefined;
  private math = false;
  private rawLine = false;
  private ended = false;
  private carriageReturn = false;
  private escape: "text" | "escape" | "csi" | "osc" | "osc_escape" = "text";
  constructor(private readonly output: (text: string) => void, private readonly color: boolean) {}

  write(chunk: string): void {
    if (this.ended) return;
    for (const character of chunk) {
      // Escape sequences can span events; never let model output control the terminal.
      if (this.escape === "osc") { if (character === "\x07" || character === "\x9c") this.escape = "text"; else if (character === "\x1b") this.escape = "osc_escape"; continue; }
      if (this.escape === "osc_escape") { this.escape = character === "\\" ? "text" : "osc"; continue; }
      if (this.escape === "csi") { if (/[\x40-\x7e]/.test(character)) this.escape = "text"; continue; }
      if (this.escape === "escape") { this.escape = character === "[" ? "csi" : ["]", "P", "^", "_"].includes(character) ? "osc" : "text"; continue; }
      if (character === "\x1b") { this.escape = "escape"; continue; }
      if (character === "\x9b") { this.escape = "csi"; continue; }
      if (character === "\x9d") { this.escape = "osc"; continue; }
      if (character === "\r") { this.append("\n"); this.carriageReturn = true; continue; }
      if (character === "\n" && this.carriageReturn) { this.carriageReturn = false; continue; }
      this.carriageReturn = false;
      const point = character.codePointAt(0)!;
      if ((point < 32 && character !== "\n" && character !== "\t") || (point >= 127 && point <= 159)) continue;
      this.append(character);
    }
  }

  /** Timed flush makes short prose visible before the provider finishes a line. */
  flush(): void {
    if (this.ended || !this.pending) return;
    // Delimiter lines need a newline to disambiguate code/math from ordinary text.
    if (!this.rawLine && /^\s*(?:`|~|#|\$)/.test(this.pending)) return;
    this.output(this.rawLine ? this.pending : this.renderLine(this.pending));
    this.pending = ""; this.rawLine = true;
  }

  end(): void {
    if (this.ended) return;
    if (this.pending) this.output(this.rawLine ? this.pending : this.renderLine(this.pending));
    this.pending = "";
    this.ended = true;
  }

  private append(character: string): void {
    if (character === "\n") {
      this.output((this.rawLine ? this.pending : this.renderLine(this.pending)) + "\n");
      this.pending = ""; this.rawLine = false;
    } else {
      this.pending += character;
      // A provider may emit a very long paragraph without any newline. Keep streaming.
      if (this.pending.length >= 1_024) {
        this.output(this.rawLine ? this.pending : this.renderLine(this.pending));
        this.pending = ""; this.rawLine = true;
      }
    }
  }

  private renderLine(line: string): string {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (delimiter) {
      const marker = delimiter[1]!;
      if (!this.fence) this.fence = { marker: marker[0]!, length: marker.length };
      else if (marker[0] === this.fence.marker && marker.length >= this.fence.length && !delimiter[2]!.trim()) this.fence = undefined;
      return this.color ? `\x1b[2m${line}\x1b[0m` : line;
    }
    if (this.fence || /^ {4}|^\t/.test(line)) return line;
    if (line.trim() === "$$") { this.math = !this.math; return line; }
    if (!this.color || this.math || line.includes("$") || line.includes("|")) return line;
    const heading = /^ {0,3}#{1,6}\s+(.+?)(?:\s+#+)?$/.exec(line);
    if (heading) return `\x1b[1;36m${heading[1]}\x1b[0m`;
    return line.replace(/^(\s*)[-*+]\s+/, "$1• ").replace(/(`[^`]+`)|\*\*([^*]+)\*\*/g, (_match, code: string | undefined, bold: string | undefined) => code ? `\x1b[36m${code.slice(1, -1)}\x1b[0m` : `\x1b[1m${bold}\x1b[0m`);
  }
}

export function formatTerminalMarkdown(text: string, color: boolean): string {
  let output = "";
  const writer = new TerminalMarkdownWriter((chunk) => { output += chunk; }, color);
  writer.write(text); writer.end();
  return output;
}
