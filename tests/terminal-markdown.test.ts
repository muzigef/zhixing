import { describe, expect, it } from "vitest";
import { TerminalMarkdownWriter, formatTerminalMarkdown } from "../src/terminal-markdown.js";

const sample = '# 梯度\n\n**先看结论**：梯度指向增长最快的方向。\n\n- 保留变量 $x$。\n\n$$\n\\frac{\\partial L}{\\partial x} = 2x\n$$\n\n```python\n# keep comment\nprint("**literal**")\n```\n\n| 方法 | 用途 |\n| --- | --- |\n| 梯度 | 优化 |';
describe("terminal Markdown presentation", () => {
  it("keeps exportable Markdown, math, code and tables exact without terminal colors", () => {
    expect(formatTerminalMarkdown(sample, false)).toBe(sample);
  });
  it("renders headings and emphasis on a TTY while leaving code/math intact", () => {
    const rendered = formatTerminalMarkdown(sample, true);
    expect(rendered).toContain('\x1b[1;36m梯度\x1b[0m');
    expect(rendered).toContain('\x1b[1m先看结论\x1b[0m');
    expect(rendered).toContain('print("**literal**")');
    expect(rendered).toContain('\\frac{\\partial L}{\\partial x} = 2x');
    expect(rendered).toContain('| 方法 | 用途 |');
  });
  it("produces identical output when fences, bold and math are fragmented across chunks", () => {
    let output = '';
    const writer = new TerminalMarkdownWriter((chunk) => { output += chunk; }, true);
    for (const character of sample) writer.write(character);
    writer.end(); writer.end();
    expect(output).toBe(formatTerminalMarkdown(sample, true));
  });
  it("flushes a short paragraph before a newline and never repeats it on completion", () => {
    let output = "";
    const writer = new TerminalMarkdownWriter((text) => { output += text; }, false);
    writer.write("先看结论"); writer.flush();
    expect(output).toBe("先看结论");
    writer.write("，再解释。\n"); writer.end();
    expect(output).toBe("先看结论，再解释。\n");
  });
  it("does not flush incomplete Markdown delimiters into a broken fence state", () => {
    let output = "";
    const writer = new TerminalMarkdownWriter((text) => { output += text; }, true);
    writer.write("``"); writer.flush(); expect(output).toBe("");
    writer.write("`ts\n# literal comment\n```\n"); writer.end();
    expect(output).toContain("# literal comment");
  });
  it("bounds buffering for long unbroken output and flushes the final fragment exactly once", () => {
    let output = '';
    const writer = new TerminalMarkdownWriter((chunk) => { output += chunk; }, false);
    writer.write('字'.repeat(5000));
    expect(output.length).toBeGreaterThan(0);
    writer.end(); writer.end();
    expect(output).toBe('字'.repeat(5000));
  });
  it("strips fragmented terminal control sequences and normalizes CRLF without damaging text", () => {
    let output = '';
    const writer = new TerminalMarkdownWriter((chunk) => { output += chunk; }, false);
    for (const chunk of ['正文\r', '\n\x1b]', '52;c;untrusted', '\x1b', '\\', '\x1b[2', 'J下一行\x07']) writer.write(chunk);
    writer.end();
    expect(output).toBe('正文\n下一行');
  });
});
