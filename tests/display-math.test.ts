import { expect, it } from "vitest";
import { displayMath } from "../src/display-math.js";

it("renders compact display delimiters as blocks while preserving code and inline math", () => {
  const text = "结果：$$x=2$$\n行内 $y=3$\n```latex\n$$x=2$$\n```";
  expect(displayMath(text)).toBe("结果：\n\n$$\nx=2\n$$\n\n\n行内 $y=3$\n```latex\n$$x=2$$\n```");
  expect(displayMath("$$\nx=2\n$$")).toBe("$$\nx=2\n$$");
});
