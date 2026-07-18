import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const directory = join(process.cwd(), "tests", "fixtures", "documents");
mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, "text.pdf"), makePdf("RAG evidence comes from retrieved documents."));
writeFileSync(join(directory, "scanned.pdf"), makePdf(""));
writeFileSync(join(directory, "many-pages.pdf"), makeBlankPdf(501));
writeFileSync(join(directory, "invalid.pdf"), "not a PDF fixture\n", "utf8");
writeFileSync(join(directory, "notes.md"), "# Grounding\n\nA grounded answer must cite retrieved evidence.\n", "utf8");

function makeBlankPdf(pageCount) {
  const pageIds = Array.from({ length: pageCount }, (_, index) => index + 3);
  const contentStart = pageCount + 3;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`,
    ...pageIds.map((_, index) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentStart + index} 0 R >>`),
    ...pageIds.map(() => "<< /Length 0 >>\nstream\n\nendstream"),
  ];
  return assemblePdf(objects);
}

function makePdf(text) {
  const stream = text ? `BT /F1 12 Tf 72 720 Td (${text.replaceAll("(", "\\(").replaceAll(")", "\\)")}) Tj ET` : "";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  return assemblePdf(objects);
}

function assemblePdf(objects) {
  let output = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(output));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return output;
}
