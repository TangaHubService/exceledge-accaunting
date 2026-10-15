/**
 * Minimal PDF writer for printable documents (invoices, statements, reports). A4 portrait or landscape,
 * Helvetica, text and simple tables with page breaks; no images or embedded fonts.
 */

export type PdfColumn = { header: string; width: number; align?: "left" | "right" };

export type PdfBlock =
  | { kind: "heading"; text: string }
  | { kind: "text"; text: string; bold?: boolean; size?: number }
  | { kind: "pairs"; rows: Array<[string, string]> }
  | { kind: "table"; columns: PdfColumn[]; rows: string[][]; totals?: string[] }
  | { kind: "space"; height?: number };

export type PdfDocument = { title: string; subtitle?: string; blocks: PdfBlock[]; footer?: string; landscape?: boolean };

const PAGE_W = 595;
const PAGE_H = 842;
const MARGIN = 40;
/** Approximate Helvetica advance widths (per 1000 units) for alignment and truncation. */
function charWidth(ch: string) {
  if (/[0-9]/.test(ch)) return 556;
  if (ch === " " || ch === "." || ch === "," || ch === ":" || ch === ";" || ch === "|" || ch === "'") return 278;
  if (ch === "-" || ch === "(" || ch === ")") return 333;
  if (/[il]/.test(ch)) return 222;
  if (/[fjtrI]/.test(ch)) return 300;
  if (/[mwMW]/.test(ch)) return 850;
  if (/[A-Z]/.test(ch)) return 667;
  return 520;
}

export function textWidth(text: string, size: number, bold = false) {
  let units = 0;
  for (const ch of text) units += charWidth(ch);
  return (units / 1000) * size * (bold ? 1.06 : 1);
}

function fit(text: string, width: number, size: number, bold = false) {
  if (textWidth(text, size, bold) <= width) return text;
  let out = text;
  while (out.length > 1 && textWidth(`${out}…`, size, bold) > width) out = out.slice(0, -1);
  return `${out}...`;
}

/** WinAnsi-safe string literal: escapes delimiters and replaces characters outside Latin-1. */
function literal(text: string) {
  const safe = [...text]
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (ch === "…") return "...";
      if (ch === "\u2013" || ch === "\u2014") return "-";
      if (code < 32 || code > 255) return "?";
      return ch;
    })
    .join("");
  return `(${safe.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;
}

class PageWriter {
  pages: string[][] = [];
  private ops: string[] = [];
  readonly pageW: number;
  readonly pageH: number;
  readonly contentW: number;
  y: number;

  constructor(private readonly doc: PdfDocument) {
    this.pageW = doc.landscape ? PAGE_H : PAGE_W;
    this.pageH = doc.landscape ? PAGE_W : PAGE_H;
    this.contentW = this.pageW - 2 * MARGIN;
    this.y = this.pageH - MARGIN;
    this.newPage();
  }

  newPage() {
    this.ops = [];
    this.pages.push(this.ops);
    this.y = this.pageH - MARGIN;
    this.text(this.doc.title, MARGIN, this.y - 14, 14, true);
    this.y -= 20;
    if (this.doc.subtitle) {
      this.text(this.doc.subtitle, MARGIN, this.y - 10, 9);
      this.y -= 14;
    }
    this.line(MARGIN, this.y - 2, this.pageW - MARGIN, this.y - 2);
    this.y -= 12;
  }

  ensure(height: number) {
    if (this.y - height < MARGIN + 20) this.newPage();
  }

  text(text: string, x: number, y: number, size: number, bold = false) {
    this.ops.push(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${literal(text)} Tj ET`);
  }

  line(x1: number, y1: number, x2: number, y2: number) {
    this.ops.push(`0.6 w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  paragraph(text: string, size: number, bold: boolean) {
    const words = text.split(/\s+/).filter(Boolean);
    let current = "";
    const lines: string[] = [];
    for (const word of words) {
      const next = current ? `${current} ${word}` : word;
      if (textWidth(next, size, bold) > this.contentW && current) {
        lines.push(current);
        current = word;
      } else current = next;
    }
    if (current) lines.push(current);
    for (const l of lines.length ? lines : [""]) {
      this.ensure(size + 4);
      this.text(fit(l, this.contentW, size, bold), MARGIN, this.y - size, size, bold);
      this.y -= size + 4;
    }
  }

  row(columns: PdfColumn[], cells: string[], bold: boolean, size = 8.5) {
    const total = columns.reduce((s, c) => s + c.width, 0);
    const scale = this.contentW / total;
    let x = MARGIN;
    columns.forEach((col, i) => {
      const w = col.width * scale;
      const cell = fit(cells[i] ?? "", w - 6, size, bold);
      const tx = col.align === "right" ? x + w - 3 - textWidth(cell, size, bold) : x + 3;
      this.text(cell, tx, this.y - size, size, bold);
      x += w;
    });
    this.y -= size + 5;
  }

  table(block: Extract<PdfBlock, { kind: "table" }>) {
    const header = () => {
      this.row(block.columns, block.columns.map((c) => c.header), true);
      this.line(MARGIN, this.y + 2, this.pageW - MARGIN, this.y + 2);
      this.y -= 2;
    };
    this.ensure(30);
    header();
    for (const r of block.rows) {
      if (this.y - 14 < MARGIN + 20) {
        this.newPage();
        header();
      }
      this.row(block.columns, r, false);
    }
    if (block.totals) {
      this.ensure(16);
      this.line(MARGIN, this.y + 2, this.pageW - MARGIN, this.y + 2);
      this.y -= 2;
      this.row(block.columns, block.totals, true);
    }
    this.y -= 6;
  }
}

/** Renders a document to PDF bytes. */
export function renderPdf(doc: PdfDocument): Buffer {
  const w = new PageWriter(doc);
  for (const block of doc.blocks) {
    switch (block.kind) {
      case "heading":
        w.ensure(24);
        w.y -= 4;
        w.paragraph(block.text, 11, true);
        break;
      case "text":
        w.paragraph(block.text, block.size ?? 9, Boolean(block.bold));
        break;
      case "pairs":
        for (const [k, v] of block.rows) {
          w.ensure(14);
          w.text(fit(k, 150, 9, true), MARGIN, w.y - 9, 9, true);
          w.text(fit(v, w.contentW - 160, 9), MARGIN + 160, w.y - 9, 9);
          w.y -= 13;
        }
        w.y -= 4;
        break;
      case "table":
        w.table(block);
        break;
      case "space":
        w.y -= block.height ?? 10;
        break;
    }
  }

  const total = w.pages.length;
  w.pages.forEach((ops, i) => {
    const label = `${doc.footer ? `${doc.footer}  ·  ` : ""}Page ${i + 1} of ${total}`;
    ops.push(`BT /F1 7.5 Tf ${MARGIN} ${MARGIN - 18} Td ${literal(label.replace("·", "-"))} Tj ET`);
  });

  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  const kids: string[] = [];
  w.pages.forEach((ops, i) => {
    const pageId = 5 + i * 2;
    const contentId = pageId + 1;
    const stream = ops.join("\n");
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w.pageW} ${w.pageH}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    kids.push(`${pageId} 0 R`);
  });
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;

  let body = "%PDF-1.4\n%\xE2\xE3\xCF\xD3\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(body, "latin1");
    body += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, "latin1");
  body += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) body += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}

/** Money as 1,234.56 for documents. */
export function pdfMoney(value: number | { toString(): string } | null | undefined) {
  const n = Number(value ?? 0);
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function pdfDate(value: Date | string | null | undefined) {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}
