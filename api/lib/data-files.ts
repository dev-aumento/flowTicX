import zlib from "node:zlib";
import { jsPDF } from "jspdf";
import JSZip from "jszip";

export type TabularFile = {
  headers: string[];
  rows: string[][];
};

const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export function toCsv(table: TabularFile) {
  const lines = [table.headers, ...table.rows].map((row) => row.map(escapeCsv).join(","));
  return lines.join("\r\n");
}

export function parseCsv(text: string): TabularFile {
  const grid = parseCsvGrid(stripBom(text));
  if (grid.length === 0) return { headers: [], rows: [] };
  const headers = grid[0].map((cell) => cell.trim());
  const rows = grid.slice(1).filter((row) => row.some((cell) => cell.trim()));
  return { headers, rows };
}

export async function toPdf(table: TabularFile, title: string) {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: false });
  doc.setFont("courier", "normal");
  doc.setFontSize(11);
  doc.text(title, 10, 12);
  doc.setFontSize(8);
  const lines = toCsv(table).split("\r\n");
  let y = 20;
  for (const line of lines) {
    if (y > 200) {
      doc.addPage();
      y = 12;
    }
    doc.text(line, 8, y);
    y += 5;
  }
  const data = doc.output("arraybuffer");
  return Buffer.from(data);
}

export function parsePdf(buffer: Buffer): TabularFile {
  const text = extractPdfText(buffer);
  const csv = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes(",") || line.includes("|"))
    .map((line) => (line.includes(",") ? line : line.replace(/\s*\|\s*/g, ",")))
    .join("\n");
  return parseCsv(csv);
}

export async function toDocx(table: TabularFile, title: string) {
  const rows = [table.headers, ...table.rows];
  const tableXml = rows
    .map(
      (row) =>
        `<w:tr>${row
          .map(
            (cell) =>
              `<w:tc><w:p><w:r><w:t xml:space="preserve">${escapeXml(cell)}</w:t></w:r></w:p></w:tc>`,
          )
          .join("")}</w:tr>`,
    )
    .join("");
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${WORD_NS}">
  <w:body>
    <w:p><w:r><w:t>${escapeXml(title)}</w:t></w:r></w:p>
    <w:tbl>${tableXml}</w:tbl>
    <w:sectPr/>
  </w:body>
</w:document>`;
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
  );
  zip.file("word/document.xml", document);
  zip.file(
    "word/_rels/document.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

export async function parseDocx(buffer: Buffer): Promise<TabularFile> {
  const zip = await JSZip.loadAsync(buffer);
  const file = zip.file("word/document.xml");
  if (!file) {
    throw new Error("This Word file has no document body. Use a .docx table exported from Manage data.");
  }
  const xml = await file.async("string");
  const rowMatches = xml.match(/<w:tr\b[\s\S]*?<\/w:tr>/g) ?? [];
  const grid = rowMatches.map((row) => {
    const cells = row.match(/<w:tc\b[\s\S]*?<\/w:tc>/g) ?? [];
    return cells.map((cell) => {
      const texts = [...cell.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map((match) =>
        unescapeXml(match[1] ?? ""),
      );
      return texts.join("");
    });
  });
  if (grid.length === 0) return { headers: [], rows: [] };
  return { headers: grid[0].map((cell) => cell.trim()), rows: grid.slice(1).filter((row) => row.some((cell) => cell.trim())) };
}

export function parseHtmlTable(text: string): TabularFile | null {
  if (!/<table[\s>]/i.test(text)) return null;
  const rowMatches = text.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? [];
  const grid = rowMatches.map((row) => {
    const cells = row.match(/<t[dh]\b[\s\S]*?<\/t[dh]>/gi) ?? [];
    return cells.map((cell) =>
      cell
        .replace(/<[^>]+>/g, "")
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .trim(),
    );
  });
  if (grid.length === 0) return null;
  return { headers: grid[0], rows: grid.slice(1).filter((row) => row.some((cell) => cell.trim())) };
}

function escapeCsv(value: string) {
  const text = value ?? "";
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function stripBom(text: string) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function parseCsvGrid(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char !== "\r") cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function unescapeXml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

function extractPdfText(buffer: Buffer) {
  const raw = buffer.toString("latin1");
  const streams: string[] = [];
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamRe.exec(raw))) {
    const body = Buffer.from(match[1], "latin1");
    try {
      streams.push(zlib.inflateSync(body).toString("latin1"));
    } catch {
      const text = body.toString("latin1");
      if (text.includes("Tj") || text.includes("TJ")) streams.push(text);
    }
  }
  const parts: string[] = [];
  const combined = streams.length > 0 ? streams.join("\n") : raw;
  const literal = /\(((?:\\\)|\\.|[^\\)])*)\)\s*Tj/g;
  while ((match = literal.exec(combined))) {
    parts.push(unescapePdf(match[1]));
  }
  const hex = /<([0-9A-Fa-f\s]+)>\s*Tj/g;
  while ((match = hex.exec(combined))) {
    parts.push(hexToText(match[1]));
  }
  return parts.join("\n");
}

function unescapePdf(value: string) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

function hexToText(hex: string) {
  const clean = hex.replace(/\s+/g, "");
  let text = "";
  for (let i = 0; i + 1 < clean.length; i += 2) {
    text += String.fromCharCode(Number.parseInt(clean.slice(i, i + 2), 16));
  }
  return text;
}
