import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { ReplInput, ReplOutput } from "../src/repl-input.js";

describe("exclusive input ownership", () => {
  it("keeps hidden input out of the conversational stream and resumes after completion", async () => {
    const source = new PassThrough(); const input = new ReplInput(source);
    let visible = ""; input.stream.on("data", (data: Buffer) => { visible += data.toString(); });
    source.write("before\n");
    await input.exclusive(async () => { source.write("private fixture value\n"); });
    source.write("after\n");
    await new Promise(setImmediate);
    expect(visible).toBe("before\nafter\n");
    input.close();
  });
  it("restores the conversation input after hidden input fails", async () => {
    const source = new PassThrough(); const input = new ReplInput(source);
    let visible = ""; input.stream.on("data", (data: Buffer) => { visible += data.toString(); });
    await expect(input.exclusive(async () => { throw new Error("cancelled"); })).rejects.toThrow("cancelled");
    source.write("next"); expect(visible).toBe("next"); input.close();
  });
});

describe("input and answer display", () => {
  it("keeps a draft on its own line and holds generated text until input is submitted", () => {
    let visible = "";
    const output = new ReplOutput((text) => { visible += text; });
    output.write("未换行的回答"); output.beginInput();
    expect(visible).toBe("未换行的回答\n");
    output.write("后续解释。\n");
    expect(visible).not.toContain("后续解释");
    output.endInput();
    expect(visible).toBe("未换行的回答\n后续解释。\n");
    output.endInput(); expect(visible.split("后续解释")).toHaveLength(2);
  });
  it("does not add extra blank lines to already completed paragraphs", () => {
    let visible = "";
    const output = new ReplOutput((text) => { visible += text; });
    output.write("段落。\n"); output.beginInput(); output.endInput();
    expect(visible).toBe("段落。\n");
  });
});
