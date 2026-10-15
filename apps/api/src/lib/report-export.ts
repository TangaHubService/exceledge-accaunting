import type { Response } from "express";
import ExcelJS from "exceljs";
import { pdfDate, pdfMoney, renderPdf, type PdfBlock, type PdfColumn } from "./pdf";

export const EXPORT_FORMATS = ["csv", "xlsx", "pdf"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export type ReportColumn = { key: string; header: string; type?: "text" | "money" | "date"; width?: number };
export type ReportRow = Record<string, string | number | Date | null | undefined>;
export type ReportSection = { title?: string; columns: ReportColumn[]; rows: ReportRow[]; totals?: ReportRow };
export type ReportDocument = {
  title: string;
  subtitle?: string;
  /** Base file name without extension. */
  filename: string;
  sections: ReportSection[];
  notes?: string[];
  landscape?: boolean;
};

/** `?format=csv|xlsx|pdf`; undefined means the JSON report. */
export function exportFormat(value: unknown): ExportFormat | undefined {
  if (typeof value !== "string" || !value) return undefined;
  const format = value.toLowerCase();
  if (!(EXPORT_FORMATS as readonly string[]).includes(format)) throw new Error("format must be csv, xlsx or pdf");
  return format as ExportFormat;
}

/** A `yyyy-mm-dd` query value as the start or end of that UTC day. */
export function queryDay(value: unknown, edge: "start" | "end", name: string): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const d = new Date(`${value.trim().slice(0, 10)}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`${name} must be a yyyy-mm-dd date`);
  return d;
}

/** Cost centre, project and branch filters from the query string. */
export function queryDims(query: Record<string, unknown>) {
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  return { costCentre: text(query.costCentre), project: text(query.project), branchId: text(query.branchId) };
}

/** CSV cell that spreadsheet programs will not run as a formula. Numbers are written as numbers. */
export function csvCell(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  const s = typeof value === "string" ? value : value instanceof Date ? value.toISOString() : JSON.stringify(value);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

const isoDate = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : v);

function cellValue(column: ReportColumn, value: ReportRow[string]) {
  if (value === null || value === undefined || value === "") return null;
  if (column.type === "money") {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }
  if (column.type === "date") {
    const d = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return value;
}

export function renderCsv(doc: ReportDocument) {
  const lines: string[] = [csvCell(doc.title)];
  if (doc.subtitle) lines.push(csvCell(doc.subtitle));
  for (const section of doc.sections) {
    lines.push("");
    if (section.title) lines.push(csvCell(section.title));
    lines.push(section.columns.map((c) => csvCell(c.header)).join(","));
    const write = (row: ReportRow) =>
      lines.push(section.columns.map((c) => csvCell(c.type === "date" ? isoDate(cellValue(c, row[c.key])) : cellValue(c, row[c.key]))).join(","));
    section.rows.forEach(write);
    if (section.totals) write(section.totals);
  }
  for (const note of doc.notes ?? []) lines.push(csvCell(note));
  return Buffer.from(`${lines.join("\r\n")}\r\n`, "utf8");
}

const MONEY_FORMAT = "#,##0.00;[Red]-#,##0.00";

export async function renderXlsx(doc: ReportDocument) {
  const book = new ExcelJS.Workbook();
  book.created = new Date();
  const used = new Set<string>();
  const sheetName = (title: string | undefined, index: number) => {
    const base = (title || `Sheet ${index + 1}`).replace(/[*?:\\/[\]]/g, " ").slice(0, 31).trim() || `Sheet ${index + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 27)} ${n}`;
    used.add(name.toLowerCase());
    return name;
  };
  doc.sections.forEach((section, index) => {
    const sheet = book.addWorksheet(sheetName(section.title ?? (doc.sections.length === 1 ? doc.title : undefined), index));
    sheet.addRow([doc.title]).font = { bold: true, size: 13 };
    if (doc.subtitle) sheet.addRow([doc.subtitle]);
    if (section.title && doc.sections.length > 1) sheet.addRow([section.title]).font = { bold: true };
    sheet.addRow([]);
    sheet.addRow(section.columns.map((c) => c.header)).font = { bold: true };
    const write = (row: ReportRow, bold = false) => {
      const added = sheet.addRow(section.columns.map((c) => cellValue(c, row[c.key])));
      if (bold) added.font = { bold: true };
    };
    section.rows.forEach((r) => write(r));
    if (section.totals) write(section.totals, true);
    section.columns.forEach((c, i) => {
      const col = sheet.getColumn(i + 1);
      col.width = c.width ?? (c.type === "money" ? 16 : c.type === "date" ? 12 : i === 0 ? 14 : 32);
      if (c.type === "money") col.numFmt = MONEY_FORMAT;
      if (c.type === "date") col.numFmt = "yyyy-mm-dd";
    });
    if (index === doc.sections.length - 1) for (const note of doc.notes ?? []) sheet.addRow([note]);
  });
  return Buffer.from(await book.xlsx.writeBuffer());
}

export function renderReportPdf(doc: ReportDocument) {
  const blocks: PdfBlock[] = [];
  for (const section of doc.sections) {
    if (section.title) blocks.push({ kind: "heading", text: section.title });
    const columns: PdfColumn[] = section.columns.map((c, i) => ({
      header: c.header,
      width: c.width ?? (c.type === "money" ? 16 : c.type === "date" ? 12 : i === 0 ? 14 : 32),
      align: c.type === "money" ? "right" : "left",
    }));
    const cells = (row: ReportRow) =>
      section.columns.map((c) => {
        const v = cellValue(c, row[c.key]);
        if (v === null || v === undefined || v === "") return "";
        if (c.type === "money") return pdfMoney(v as number);
        if (c.type === "date") return pdfDate(v as Date);
        return v instanceof Date ? pdfDate(v) : String(v);
      });
    blocks.push({ kind: "table", columns, rows: section.rows.map(cells), totals: section.totals ? cells(section.totals) : undefined });
  }
  for (const note of doc.notes ?? []) blocks.push({ kind: "text", text: note, size: 8 });
  return renderPdf({ title: doc.title, subtitle: doc.subtitle, blocks, landscape: doc.landscape, footer: `Printed ${new Date().toISOString().slice(0, 10)}` });
}

const CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

export async function sendReport(res: Response, doc: ReportDocument, format: ExportFormat) {
  const body = format === "csv" ? renderCsv(doc) : format === "xlsx" ? await renderXlsx(doc) : renderReportPdf(doc);
  const filename = `${doc.filename.replace(/[^A-Za-z0-9._-]+/g, "-")}.${format}`;
  res.setHeader("Content-Type", CONTENT_TYPES[format]);
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(body);
}
