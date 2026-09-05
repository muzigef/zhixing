import { PassThrough, type Readable } from "node:stream";
type TerminalSource = Readable & { isTTY?: boolean; isRaw?: boolean; setRawMode?: (raw: boolean) => unknown };

/** One permanent input bridge prevents hidden bytes from being replayed into the REPL. */
export class ReplInput {
  readonly stream = new PassThrough();
  private readonly wasRaw: boolean;
  private closed = false;
  private hidden = false;
  beforeInput?: (data: Buffer | string) => void;
  private readonly onData = (data: Buffer | string): void => { if (!this.hidden) { this.beforeInput?.(data); this.stream.write(data); } };
  private readonly onEnd = (): void => { this.stream.end(); };
  private readonly onError = (error: Error): void => { this.stream.destroy(error); };
  constructor(private readonly source: TerminalSource) {
    this.wasRaw = Boolean(source.isRaw);
    if (source.isTTY) source.setRawMode?.(true);
    source.on("data", this.onData); source.on("end", this.onEnd); source.on("error", this.onError);
  }
  async exclusive<T>(read: () => Promise<T>): Promise<T> {
    this.hidden = true;
    try { return await read(); }
    finally { this.hidden = false; if (!this.closed && this.source.isTTY) this.source.setRawMode?.(true); }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.source.off("data", this.onData); this.source.off("end", this.onEnd); this.source.off("error", this.onError);
    this.source.pause();
    this.stream.destroy();
    if (this.source.isTTY) this.source.setRawMode?.(this.wasRaw);
  }
}

/** A portable inline display: keep generated chunks away from an unfinished input draft. */
export class ReplOutput {
  private held = "";
  private lineOpen = false;
  composing = false;
  constructor(private readonly output: (text: string) => void) {}
  write(text: string): void {
    if (!text) return;
    if (this.composing) { this.held += text; return; }
    this.output(text); this.lineOpen = !text.endsWith("\n");
  }
  beginInput(): void {
    if (this.composing) return;
    if (this.lineOpen) this.output("\n");
    this.lineOpen = false; this.composing = true;
  }
  endInput(): void {
    this.composing = false;
    const text = this.held; this.held = "";
    this.write(text);
  }
}
