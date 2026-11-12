import { backendTypeFor, COA_TAXONOMY, encodeReportingGroup } from "./coa-taxonomy";
import type { Account, AccountType } from "./types";

/**
 * Chart of accounts import, shared by the Import data flow: CSV parsing, QuickBooks header and type names,
 * and the same rules as the chart (optional free-form numbers, names unique under a parent, "Parent:Child").
 */

export type ImportRow = {
  line: number;
  code: string;
  name: string;
  type: string;
  parentCode: string;
  /** "Parent:Child" path of the parent when it has no number (account numbers off). */
  parentName: string;
  description: string;
  reportingGroup: string;
  problem?: string;
};

const BACKEND_TYPES: AccountType[] = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "COST_OF_SALES", "EXPENSE", "OTHER_INCOME", "OTHER_EXPENSE"];

/** Header aliases: this app's template, plus the columns QuickBooks puts in its Account List export. */
export const HEADER_ALIASES: Record<string, keyof Omit<ImportRow, "line" | "problem"> | "detailType"> = {
  reportinggroup: "reportingGroup",
  code: "code",
  number: "code",
  "account number": "code",
  "account #": "code",
  "acct num": "code",
  "no.": "code",
  no: "code",
  name: "name",
  "account name": "name",
  "full name": "name",
  account: "name",
  type: "type",
  "account type": "type",
  "detail type": "detailType",
  detailtype: "detailType",
  parentcode: "parentCode",
  "parent code": "parentCode",
  parent: "parentCode",
  "parent account number": "parentCode",
  description: "description",
};

/** RFC 4180-ish CSV: quoted fields, doubled quotes, commas and newlines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim()));
}

/** Resolve a type cell: a backend type, a QuickBooks account type label, or a detail type. */
function resolveType(typeCell: string, detailCell: string): { type?: AccountType; label?: string; detail?: string } {
  const raw = typeCell.trim();
  const upper = raw.toUpperCase().replace(/[\s-]+/g, "_");
  if ((BACKEND_TYPES as string[]).includes(upper)) return { type: upper as AccountType, detail: detailCell || undefined };
  const lower = raw.toLowerCase();
  for (const block of COA_TAXONOMY) {
    for (const opt of block.accountTypes) {
      if (opt.label.toLowerCase() === lower) return { type: opt.backendType, label: opt.label, detail: detailCell || opt.detailTypes[0] };
    }
  }
  // QuickBooks Online export names (US/UK editions) that differ from our labels.
  const qbo: Record<string, string> = {
    bank: "Cash and cash equivalents",
    "other current assets": "Current assets",
    "other current asset": "Current assets",
    "fixed asset": "Fixed assets",
    "other assets": "Non-current assets",
    "other asset": "Non-current assets",
    "accounts receivable": "Accounts receivable (A/R)",
    "accounts payable": "Accounts payable (A/P)",
    "other current liabilities": "Current liabilities",
    "other current liability": "Current liabilities",
    "long term liabilities": "Non-current liabilities",
    "long term liability": "Non-current liabilities",
    equity: "Owner's equity",
    "cost of goods sold": "Cost of sales",
    expense: "Expenses",
    "other expenses": "Other expense",
  };
  const mapped = qbo[lower];
  if (mapped) {
    const bt = backendTypeFor(mapped);
    if (bt) return { type: bt, label: mapped, detail: detailCell || undefined };
  }
  return {};
}

const pathKey = (segments: string[]) => segments.map((s) => s.trim().toLowerCase()).join(":");

/** "Parent:Child" full names of the accounts already in the chart, keyed for lookup. */
function existingFullNames(accounts: Account[]): Map<string, string> {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const out = new Map<string, string>();
  for (const a of accounts) {
    const segments = [a.name];
    let parent = a.parentId ? byId.get(a.parentId) : undefined;
    for (let guard = 0; parent && guard < 20; guard++) {
      segments.unshift(parent.name);
      parent = parent.parentId ? byId.get(parent.parentId) : undefined;
    }
    out.set(pathKey(segments), a.code);
  }
  return out;
}

export function toRows(table: string[][], accounts: Account[]): { rows: ImportRow[]; missing: string[] } {
  const existing = new Set(accounts.map((a) => a.code));
  const [header, ...body] = table;
  const cols = header.map((h) => HEADER_ALIASES[h.trim().toLowerCase()]);
  // QuickBooks: account numbers are optional, so only name and type are required.
  const missing = (["name", "type"] as const).filter((k) => !cols.includes(k));
  if (missing.length) return { rows: [], missing };
  const seen = new Set<string>();
  const parsed = body.map((cells, i) => {
    const get = (k: string) => (cells[cols.indexOf(k as never)] ?? "").trim();
    const resolved = resolveType(get("type"), get("detailType"));
    const code = get("code").replace(/\s/g, "");
    // QuickBooks full names are "Parent:Child"; the prefix says which account this one sits under.
    const path = get("name").split(":").map((s) => s.trim());
    const row: ImportRow = {
      line: i + 2,
      code,
      name: path[path.length - 1],
      type: resolved.type ?? get("type"),
      parentCode: get("parentCode"),
      parentName: "",
      description: get("description"),
      reportingGroup: resolved.label ? encodeReportingGroup(resolved.label, resolved.detail ?? "") : get("reportingGroup"),
    };
    if (code && !/^[A-Za-z0-9][A-Za-z0-9.-]{0,6}$/.test(code)) row.problem = "Account numbers are up to 7 letters, digits, \".\" or \"-\"";
    else if (!row.name) row.problem = "Missing name";
    else if (!resolved.type) row.problem = `Unknown account type "${get("type")}"`;
    else if (code && existing.has(code)) row.problem = "Number already in your chart — will be skipped";
    else if (code && seen.has(code)) row.problem = "Duplicate number in this file";
    if (code) seen.add(code);
    return { row, path };
  });

  // Resolve "Parent:Child" to the parent: rows in this file first, then the existing chart.
  const inFile = new Map(parsed.map(({ row, path }) => [pathKey(path), row]));
  const inChart = existingFullNames(accounts);
  const seenNames = new Set<string>();
  for (const { row, path } of parsed) {
    const key = pathKey(path);
    // Same rules as the chart: a name is unique among accounts that share a parent.
    if (!row.problem && path.length === 1 && !row.parentCode && inChart.has(key)) row.problem = "Already in your chart — will be skipped";
    if (!row.problem && path.length > 1 && inChart.has(key)) row.problem = "Already in your chart — will be skipped";
    if (!row.problem && seenNames.has(key)) row.problem = "Same name twice under one parent in this file";
    seenNames.add(key);
    if (row.parentCode || path.length < 2) continue;
    const parentPath = path.slice(0, -1);
    const fileParent = inFile.get(pathKey(parentPath));
    const chartCode = inChart.get(pathKey(parentPath));
    if (fileParent?.code) row.parentCode = fileParent.code;
    else if (fileParent) row.parentName = parentPath.join(":");
    else if (chartCode) row.parentCode = chartCode;
    else if (!row.problem) row.problem = `Parent account "${parentPath.join(":")}" is not in this file or your chart`;
  }
  return { rows: parsed.map((p) => p.row), missing: [] };
}

/** The fields QuickBooks asks you to map in step 2 of a chart of accounts import. */
export const IMPORT_FIELDS = [
  { key: "code", header: "code", label: "Account number", required: false },
  { key: "name", header: "name", label: "Account name", required: true, hint: 'Full names like "Parent:Child" create subaccounts' },
  { key: "type", header: "type", label: "Type", required: true },
  { key: "detailType", header: "detail type", label: "Detail type", required: false },
  { key: "parentCode", header: "parentcode", label: "Parent account number", required: false },
  { key: "description", header: "description", label: "Description", required: false },
] as const;
export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];
export type ImportMapping = Partial<Record<ImportFieldKey, number>>;

/** Pre-select the column whose header QuickBooks or this app would use for each field. */
export function autoMap(headers: string[]): ImportMapping {
  const out: ImportMapping = {};
  headers.forEach((h, i) => {
    const field = HEADER_ALIASES[h.trim().toLowerCase()] as ImportFieldKey | undefined;
    if (field && out[field] === undefined) out[field] = i;
  });
  return out;
}

/** Rebuild the table with the chosen columns under the headers the parser expects. */
export function applyMapping(table: string[][], mapping: ImportMapping): string[][] {
  const fields = IMPORT_FIELDS.filter((f) => mapping[f.key] !== undefined);
  return [fields.map((f) => f.header), ...table.slice(1).map((row) => fields.map((f) => row[mapping[f.key]!] ?? ""))];
}
