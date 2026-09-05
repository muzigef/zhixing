/** Presentation-only normalization; the original provider text remains available for copying. */
export function displayMath(text: string): string {
  const parts = text.split(/((?:^|\n)[ \t]*(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*(?:`{3,}|~{3,})[^\n]*(?=\n|$)|$))/);
  return parts.map((part, index) => index % 2 ? part : part.replace(/(?<![\\$])\$\$([^$\n]+)\$\$(?!\$)/g, (_match, formula: string) => `\n\n$$\n${formula.trim()}\n$$\n\n`)).join("");
}
