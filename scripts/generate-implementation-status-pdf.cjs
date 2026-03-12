const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const inputPath = path.join(root, "IMPLEMENTATION_STATUS.md");
const outputPath = path.join(root, "docs", "IMPLEMENTATION_STATUS.pdf");

function normalizeLine(line) {
  return line
    .replace(/\r/g, "")
    .replace(/^#{1,6}\s*/g, "")
    .replace(/^\s*-\s+/g, "- ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/[^\x20-\x7E]/g, " ")
    .trimEnd();
}

function wrapLine(line, maxChars) {
  if (!line || line.length <= maxChars) {
    return [line];
  }

  const words = line.split(/\s+/).filter(Boolean);
  const wrapped = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= maxChars) {
      current = next;
    } else {
      if (current) wrapped.push(current);
      current = word;
    }
  }

  if (current) wrapped.push(current);
  return wrapped;
}

function toPrintableLines(markdown) {
  const rawLines = markdown.split("\n").map(normalizeLine);
  const output = [];

  for (const raw of rawLines) {
    if (!raw) {
      output.push("");
      continue;
    }
    const wrapped = wrapLine(raw, 95);
    output.push(...wrapped);
  }

  return output;
}

function splitPages(lines, linesPerPage) {
  const pages = [];
  for (let i = 0; i < lines.length; i += linesPerPage) {
    pages.push(lines.slice(i, i + linesPerPage));
  }
  return pages.length ? pages : [["No content available."]];
}

function escapePdfText(text) {
  const safe = text
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/[^\x20-\x7E]/g, " ");
  return `(${safe})`;
}

function createContentStream(lines) {
  const commands = [
    "BT",
    "/F1 10 Tf",
    "50 790 Td",
    "14 TL"
  ];

  for (const line of lines) {
    commands.push(`${escapePdfText(line)} Tj`);
    commands.push("T*");
  }

  commands.push("ET");
  return commands.join("\n");
}

function buildPdf(pageLines) {
  const pageCount = pageLines.length;
  const objects = [];

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";

  const kids = [];
  for (let i = 0; i < pageCount; i += 1) {
    const pageObj = 4 + i * 2;
    kids.push(`${pageObj} 0 R`);
  }
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pageCount} >>`;

  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";

  for (let i = 0; i < pageCount; i += 1) {
    const pageObj = 4 + i * 2;
    const contentObj = 5 + i * 2;
    const stream = createContentStream(pageLines[i]);
    const length = Buffer.byteLength(stream, "utf8");

    objects[pageObj] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObj} 0 R >>`;

    objects[contentObj] = `<< /Length ${length} >>\nstream\n${stream}\nendstream`;
  }

  const totalObjects = objects.length - 1;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (let i = 1; i <= totalObjects; i += 1) {
    offsets[i] = Buffer.byteLength(pdf, "utf8");
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${totalObjects + 1}\n`;
  pdf += "0000000000 65535 f \n";

  for (let i = 1; i <= totalObjects; i += 1) {
    const off = String(offsets[i]).padStart(10, "0");
    pdf += `${off} 00000 n \n`;
  }

  pdf += `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, "utf8");
}

function main() {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Missing input: ${inputPath}`);
  }

  const markdown = fs.readFileSync(inputPath, "utf8");
  const lines = toPrintableLines(markdown);
  const pages = splitPages(lines, 52);
  const pdfBuffer = buildPdf(pages);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, pdfBuffer);

  console.log(`PDF generated: ${outputPath}`);
}

main();
