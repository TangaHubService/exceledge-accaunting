import type { ReportDocument, ReportRow, ReportSection } from "../../lib/report-export";
import { companyHeader } from "../print/print.service";
import type { getTrialBalance } from "./books.service";
import type { periodStatements } from "./reports.service";
import type { getAccountLedger } from "../gl/gl.service";
import type { ageingReport as arAgeing } from "../ar/ar.service";
import type { ageingReport as apAgeing, withholdingReport } from "../ap/ap.service";
import type { vatReport } from "../tax/tax.service";

const day = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : "");

async function heading(companyId: string, title: string, period: string) {
  const header = await companyHeader(companyId);
  return { title: `${header.name}: ${title}`, subtitle: [period, header.subtitle].filter(Boolean).join("  |  ") };
}

const accountCols = [
  { key: "code", header: "Code", width: 10 },
  { key: "name", header: "Account", width: 34 },
];

export async function trialBalanceDocument(companyId: string, tb: Awaited<ReturnType<typeof getTrialBalance>>, asOf?: Date, compareAsOf?: Date) {
  if ("totals" in tb) {
    const head = await heading(companyId, "Trial balance", `${day(tb.from)} to ${day(tb.to)}`);
    const section: ReportSection = {
      columns: [
        ...accountCols,
        { key: "openingDebit", header: "Opening Dr", type: "money" },
        { key: "openingCredit", header: "Opening Cr", type: "money" },
        { key: "movementDebit", header: "Debits", type: "money" },
        { key: "movementCredit", header: "Credits", type: "money" },
        { key: "debit", header: "Closing Dr", type: "money" },
        { key: "credit", header: "Closing Cr", type: "money" },
      ],
      rows: tb.rows,
      totals: { name: "Total", ...tb.totals, debit: tb.debit, credit: tb.credit },
    };
    const dims = Object.entries(tb.dims).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
    return { ...head, filename: `trial-balance-${day(tb.to)}`, sections: [section], landscape: true, notes: dims.length ? [`Filtered by ${dims.join(", ")}`] : [] } satisfies ReportDocument;
  }
  const comparative = tb.mode === "COMPARATIVE";
  const asAt = day(asOf ?? new Date());
  const head = await heading(companyId, `Trial balance (${tb.mode.toLowerCase().replace(/_/g, " ")})`, `As at ${asAt}${comparative ? ` compared with ${day(compareAsOf)}` : ""}`);
  const rows = tb.rows.map((r) => ({ ...r }));
  const section: ReportSection = {
    columns: [
      ...accountCols,
      { key: "debit", header: "Debit", type: "money" },
      { key: "credit", header: "Credit", type: "money" },
      ...(comparative
        ? [
            { key: "priorDebit", header: `Debit ${day(compareAsOf)}`, type: "money" as const },
            { key: "priorCredit", header: `Credit ${day(compareAsOf)}`, type: "money" as const },
          ]
        : []),
    ],
    rows,
    totals: {
      name: "Total",
      debit: tb.debit,
      credit: tb.credit,
      ...(comparative ? { priorDebit: rows.reduce((s, r) => s + (r.priorDebit ?? 0), 0), priorCredit: rows.reduce((s, r) => s + (r.priorCredit ?? 0), 0) } : {}),
    },
  };
  return { ...head, filename: `trial-balance-${asAt}`, sections: [section] } satisfies ReportDocument;
}

type Statements = Awaited<ReturnType<typeof periodStatements>>;
export const STATEMENT_PARTS = ["income", "position", "equity", "cashflow", "notes"] as const;
export type StatementPart = (typeof STATEMENT_PARTS)[number];

export async function statementsDocument(companyId: string, s: Statements, parts: readonly StatementPart[] = STATEMENT_PARTS) {
  const range = `${day(s.from)} to ${day(s.to)}`;
  const prior = `${day(s.comparative.from)} to ${day(s.comparative.to)}`;
  const head = await heading(companyId, "Financial statements", `${range} (comparative ${prior})`);
  const cols = [
    { key: "code", header: "Code", width: 10 },
    { key: "name", header: "Line", width: 40 },
    { key: "amount", header: day(s.to), type: "money" as const },
    { key: "comparative", header: day(s.comparative.to), type: "money" as const },
  ];
  type Line = { code: string; name: string; amount: number; comparative: number };
  const block = (title: string, lines: Line[]): ReportRow[] => [
    { name: title },
    ...lines.map((l) => ({ code: l.code, name: l.name, amount: l.amount, comparative: l.comparative })),
  ];
  const total = (name: string, amount: number, comparative: number): ReportRow => ({ name, amount, comparative });
  const sections: ReportSection[] = [];
  const p = s.position;
  const cp = s.comparative.position;
  if (parts.includes("income")) {
    sections.push({
      title: "Income statement",
      columns: cols,
      rows: [
        ...block("Revenue and other income", s.income.revenue),
        total("Total revenue", s.income.totalRevenue, s.comparative.income.totalRevenue),
        ...block("Cost of sales", s.income.costOfSales),
        total("Gross profit", s.income.grossProfit, s.comparative.income.grossProfit),
        ...block("Operating expenses", s.income.operatingExpenses),
        ...block("Other expenses", s.income.otherExpenses),
        total("Total costs and expenses", s.income.totalExpenses, s.comparative.income.totalExpenses),
      ],
      totals: total("Profit for the period", s.income.profit, s.comparative.income.profit),
    });
  }
  if (parts.includes("position")) {
    sections.push({
      title: "Statement of financial position",
      columns: cols,
      rows: [
        ...block("Non-current assets", p.nonCurrentAssets),
        total("Total non-current assets", p.totals.nonCurrentAssets, cp.totals.nonCurrentAssets),
        ...block("Current assets", p.currentAssets),
        total("Total current assets", p.totals.currentAssets, cp.totals.currentAssets),
        total("Total assets", p.totalAssets, cp.totalAssets),
        ...block("Non-current liabilities", p.nonCurrentLiabilities),
        total("Total non-current liabilities", p.totals.nonCurrentLiabilities, cp.totals.nonCurrentLiabilities),
        ...block("Current liabilities", p.currentLiabilities),
        total("Total current liabilities", p.totals.currentLiabilities, cp.totals.currentLiabilities),
        total("Total liabilities", p.totalLiabilities, cp.totalLiabilities),
        ...block("Equity", p.equity),
        total("Total equity", p.totalEquity, cp.totalEquity),
      ],
      totals: total("Liabilities and equity", p.totalLiabilities + p.totalEquity, cp.totalLiabilities + cp.totalEquity),
    });
  }
  if (parts.includes("equity")) {
    const e = s.equityStatement;
    sections.push({
      title: "Statement of changes in equity",
      columns: [{ key: "label", header: range, width: 36 }, ...e.components.map((c) => ({ key: c.key, header: c.name, type: "money" as const })), { key: "total", header: "Total", type: "money" }],
      rows: e.rows.filter((r) => r.key !== "CLOSING").map((r) => ({ label: r.label, ...r.amounts, total: r.total })),
      totals: (() => {
        const closing = e.rows.find((r) => r.key === "CLOSING")!;
        return { label: closing.label, ...closing.amounts, total: closing.total };
      })(),
    });
  }
  if (parts.includes("cashflow")) {
    const c = s.cashFlow;
    const pc = s.comparative.cashFlow;
    sections.push({
      title: "Cash flow (indirect)",
      columns: cols,
      rows: [
        total("Profit for the period", c.profit, pc.profit),
        total("Add back depreciation", c.depreciation, pc.depreciation),
        total("Working capital movements", c.operating - c.profit - c.depreciation, pc.operating - pc.profit - pc.depreciation),
        total("Cash from operating activities", c.operating, pc.operating),
        total("Cash from investing activities", c.investing, pc.investing),
        total("Cash from financing activities", c.financing, pc.financing),
      ],
      totals: total("Net change in cash and bank", c.netChange, pc.netChange),
    });
  }
  const notes: string[] = [];
  if (parts.includes("notes")) {
    sections.push({
      title: "Notes",
      columns: cols,
      rows: s.notes.items.flatMap((n) => [...block(`${n.ref}. ${n.title}`, n.lines), total(`Total ${n.title.toLowerCase()}`, n.total, n.comparative)]),
    });
    notes.push(...s.notes.basis, ...s.notes.policies.map((x) => `${x.title}: ${x.text}`));
  }
  return { ...head, filename: `financial-statements-${day(s.to)}`, sections, notes, landscape: parts.includes("equity") && s.equityStatement.components.length > 3 } satisfies ReportDocument;
}

export async function ledgerDocument(companyId: string, l: Awaited<ReturnType<typeof getAccountLedger>>) {
  const head = await heading(companyId, `Ledger ${l.account.code} ${l.account.name}`, `${l.from ? day(l.from) : "Start"} to ${l.to ? day(l.to) : "today"}`);
  return {
    ...head,
    filename: `ledger-${l.account.code}-${l.to ? day(l.to) : day(new Date())}`,
    sections: [
      {
        columns: [
          { key: "transactionDate", header: "Date", type: "date" as const },
          { key: "journalNumber", header: "Journal", width: 16 },
          { key: "description", header: "Description", width: 36 },
          { key: "debit", header: "Debit", type: "money" as const },
          { key: "credit", header: "Credit", type: "money" as const },
          { key: "runningBalance", header: "Balance (Dr+)", type: "money" as const },
        ],
        rows: [{ description: "Opening balance", runningBalance: l.pageOpeningBalance }, ...l.entries],
        totals: { description: "Totals and closing balance", debit: l.totals.debit, credit: l.totals.credit, runningBalance: l.closingBalance },
      },
    ],
  } satisfies ReportDocument;
}

export async function ageingDocument(
  companyId: string,
  kind: "ar" | "ap",
  r: Awaited<ReturnType<typeof arAgeing>> | Awaited<ReturnType<typeof apAgeing>>,
) {
  const head = await heading(companyId, kind === "ar" ? "Aged receivables" : "Aged payables", `As at ${day(r.asOf)}`);
  const lines = r.lines as Array<Record<string, unknown>>;
  const rows: ReportRow[] = lines.map((l) => ({
    party: String(kind === "ar" ? l.customerName : l.supplierName),
    document: String(kind === "ar" ? l.invoiceNumber : l.billNumber),
    dueDate: l.dueDate as Date,
    bucket: r.buckets.find((b) => b.key === l.bucket)?.label ?? String(l.bucket),
    outstanding: Number(l.outstanding),
  }));
  return {
    ...head,
    filename: `${kind === "ar" ? "receivables" : "payables"}-ageing-${day(r.asOf)}`,
    sections: [
      {
        title: "Summary",
        columns: [
          { key: "label", header: "Bucket", width: 24 },
          { key: "amount", header: "Outstanding", type: "money" as const },
        ],
        rows: r.buckets.map((b) => ({ label: b.label, amount: b.amount })),
        totals: { label: "Total", amount: r.total },
      },
      {
        title: "Detail",
        columns: [
          { key: "party", header: kind === "ar" ? "Customer" : "Supplier", width: 30 },
          { key: "document", header: kind === "ar" ? "Invoice" : "Bill", width: 18 },
          { key: "dueDate", header: "Due", type: "date" as const },
          { key: "bucket", header: "Bucket", width: 14 },
          { key: "outstanding", header: "Outstanding", type: "money" as const },
        ],
        rows,
        totals: { party: "Total", outstanding: r.total },
      },
    ],
  } satisfies ReportDocument;
}

export async function vatDocument(companyId: string, v: Awaited<ReturnType<typeof vatReport>>) {
  const head = await heading(companyId, "VAT return", `${day(v.from)} to ${day(v.to)}`);
  const lineCols = [
    { key: "date", header: "Date", type: "date" as const },
    { key: "journalNumber", header: "Journal", width: 16 },
    { key: "sourceDocumentNumber", header: "Document", width: 16 },
    { key: "description", header: "Description", width: 34 },
    { key: "amount", header: "VAT", type: "money" as const },
  ];
  const totals = v.totals as Record<string, number>;
  return {
    ...head,
    filename: `vat-return-${day(v.from)}-${day(v.to)}`,
    sections: [
      {
        title: "Summary",
        columns: [
          { key: "label", header: "Item", width: 30 },
          { key: "amount", header: "Amount", type: "money" as const },
        ],
        rows: Object.entries(totals).map(([label, amount]) => ({ label: label.replace(/([A-Z])/g, " $1").toLowerCase(), amount })),
      },
      { title: "Output VAT", columns: lineCols, rows: v.outputLines, totals: { description: "Total output VAT", amount: v.outputLines.reduce((s, l) => s + l.amount, 0) } },
      { title: "Input VAT", columns: lineCols, rows: v.inputLines, totals: { description: "Total input VAT", amount: v.inputLines.reduce((s, l) => s + l.amount, 0) } },
      {
        title: "Zero-rated supplies (memo)",
        columns: [
          { key: "date", header: "Date", type: "date" as const },
          { key: "documentNumber", header: "Document", width: 16 },
          { key: "taxCode", header: "Tax code", width: 12 },
          { key: "description", header: "Description", width: 34 },
          { key: "net", header: "Net", type: "money" as const },
        ],
        rows: v.zeroRated ?? [],
        totals: { description: "Total zero-rated", net: (v.zeroRated ?? []).reduce((s, l) => s + l.net, 0) },
      },
      {
        title: "Exempt supplies (memo)",
        columns: [
          { key: "date", header: "Date", type: "date" as const },
          { key: "documentNumber", header: "Document", width: 16 },
          { key: "taxCode", header: "Tax code", width: 12 },
          { key: "description", header: "Description", width: 34 },
          { key: "net", header: "Net", type: "money" as const },
        ],
        rows: v.exempt ?? [],
        totals: { description: "Total exempt", net: (v.exempt ?? []).reduce((s, l) => s + l.net, 0) },
      },
    ],
  } satisfies ReportDocument;
}

export async function withholdingDocument(companyId: string, w: Awaited<ReturnType<typeof withholdingReport>>) {
  const head = await heading(companyId, "Withholding tax", `${day(w.from)} to ${day(w.to)}`);
  return {
    ...head,
    filename: `withholding-tax-${day(w.from)}-${day(w.to)}`,
    sections: [
      {
        columns: [
          { key: "paymentDate", header: "Date", type: "date" as const },
          { key: "paymentNumber", header: "Payment", width: 16 },
          { key: "supplierName", header: "Supplier", width: 30 },
          { key: "supplierTin", header: "TIN", width: 12 },
          { key: "grossSettled", header: "Gross", type: "money" as const },
          { key: "withholdingTax", header: "Withheld", type: "money" as const },
          { key: "netPaid", header: "Net paid", type: "money" as const },
        ],
        rows: w.rows,
        totals: { supplierName: "Total", grossSettled: w.totalSettled, withholdingTax: w.totalWithheld, netPaid: w.totalSettled - w.totalWithheld },
      },
    ],
  } satisfies ReportDocument;
}
