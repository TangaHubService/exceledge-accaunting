import { Download, Printer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useFeedback } from "../../components/feedback";
import { Modal } from "../../components/reports/kit";
import { EmptyState, ErrorState, PageHeader, SkeletonRows } from "../../components/ui";
import { useCompany } from "../../lib/company";
import { amount, date, humanize, isoDay } from "../../lib/format";
import { type CustomReport, downloadCsv, monthLong, type MonthFigures, reportNameFor, useMonthlyFigures, useYearMonths } from "../../lib/reports";
import { Link, useLocation } from "../../lib/router";
import { useResource, useSession } from "../../lib/session";
import { newId, readLocal, saveLocal, TERMS } from "../../lib/txn";
import type { Account, ApBill, ArInvoiceList, Customer, Supplier } from "../../lib/types";
import { accountMeta, BALANCE_SHEET, naturalBalance } from "../Accounts";

type Row = Record<string, unknown>;
type Col = { key: string; label: string; kind?: "money" | "date" | "text" };
type Built = { columns: Col[]; rows: Row[]; dateKey?: string; total?: boolean };

const INVOICES = "/api/v1/ar/invoices?status=ALL&pageSize=500";
const OPEN_INVOICES = "/api/v1/ar/invoices?status=OPEN&pageSize=500";
const OVERDUE_INVOICES = "/api/v1/ar/invoices?status=OVERDUE&pageSize=500";
const CUSTOMERS = "/api/v1/ar/customers";
const SUPPLIERS = "/api/v1/ap/suppliers";
const BILLS = "/api/v1/ap/bills";

const invoiceCols: Col[] = [
  { key: "invoiceDate", label: "Date", kind: "date" },
  { key: "invoiceNumber", label: "Invoice" },
  { key: "customerName", label: "Customer" },
  { key: "dueDate", label: "Due date", kind: "date" },
  { key: "gross", label: "Amount", kind: "money" },
  { key: "paid", label: "Received", kind: "money" },
  { key: "outstanding", label: "Open balance", kind: "money" },
];
const fromInvoices = (d: unknown) => (d as ArInvoiceList).rows as unknown as Row[];

function groupByCustomer(d: unknown): Row[] {
  const out = new Map<string, Row & { customer: string; invoices: number; gross: number; net: number; outstanding: number }>();
  for (const i of (d as ArInvoiceList).rows) {
    const r = out.get(i.customerName) ?? { customer: i.customerName, invoices: 0, gross: 0, net: 0, outstanding: 0 };
    r.invoices += 1;
    r.gross += i.gross;
    r.net += i.net;
    r.outstanding += i.outstanding;
    out.set(i.customerName, r);
  }
  return [...out.values()].sort((a, b) => b.net - a.net);
}

/** Pulls rows out of the list shapes the API returns, for the type-driven custom reports. */
const anyRows = (d: unknown): Row[] => (Array.isArray(d) ? (d as Row[]) : (((d as { rows?: Row[]; items?: Row[] })?.rows ?? (d as { items?: Row[] })?.items ?? []) as Row[]));

function autoColumns(rows: Row[]): Col[] {
  const first = rows[0];
  if (!first) return [];
  return Object.keys(first)
    .filter((k) => !/id$/i.test(k) && ["string", "number"].includes(typeof first[k]))
    .slice(0, 7)
    .map((key) => ({
      key,
      label: humanize(key.replace(/([a-z])([A-Z])/g, "$1_$2")),
      kind: /date/i.test(key) ? ("date" as const) : typeof first[key] === "number" ? ("money" as const) : ("text" as const),
    }));
}


const accountListCols: Col[] = [
  { key: "code", label: "No." },
  { key: "account", label: "Account" },
  { key: "type", label: "Type" },
  { key: "detailType", label: "Detail type" },
  { key: "description", label: "Description" },
  { key: "balance", label: "Balance", kind: "money" },
];

function accountListRows(accounts: Account[]): Row[] {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const fullName = (a: Account) => {
    const parts = [a.name];
    for (let p = a.parentId ? byId.get(a.parentId) : undefined, i = 0; p && i < 20; p = p.parentId ? byId.get(p.parentId) : undefined, i++) parts.unshift(p.name);
    return parts.join(":");
  };
  return accounts
    .map((a) => {
      const meta = accountMeta(a);
      return {
        code: a.code,
        account: fullName(a),
        type: meta.accountType,
        detailType: meta.detailType === "—" ? "" : meta.detailType,
        description: a.description ?? "",
        balance: BALANCE_SHEET.has(a.type) ? naturalBalance(a) : "",
      };
    })
    .sort((x, y) => x.code.localeCompare(y.code, undefined, { numeric: true }));
}

type Source = { title?: string; path: string; build: (data: unknown) => Built };

const SOURCES: Record<string, Source> = {
  "invoice-list": { path: INVOICES, build: (d) => ({ columns: invoiceCols, rows: fromInvoices(d), dateKey: "invoiceDate", total: true }) },
  "open-invoices": { path: OPEN_INVOICES, build: (d) => ({ columns: invoiceCols, rows: fromInvoices(d), dateKey: "invoiceDate", total: true }) },
  "invoices-and-received-payments": { path: INVOICES, build: (d) => ({ columns: invoiceCols, rows: fromInvoices(d).filter((r) => Number(r.paid) > 0), dateKey: "invoiceDate", total: true }) },
  "collections-report": { path: OVERDUE_INVOICES, build: (d) => ({ columns: invoiceCols, rows: fromInvoices(d), dateKey: "dueDate", total: true }) },
  "customer-balance-detail": { path: OPEN_INVOICES, build: (d) => ({ columns: [invoiceCols[2], ...invoiceCols.filter((c) => c.key !== "customerName")], rows: fromInvoices(d).sort((a, b) => String(a.customerName).localeCompare(String(b.customerName))), dateKey: "invoiceDate", total: true }) },
  "customer-balance-summary": {
    path: CUSTOMERS,
    build: (d) => ({
      columns: [{ key: "code", label: "Code" }, { key: "name", label: "Customer" }, { key: "balance", label: "Balance", kind: "money" }],
      rows: (d as Customer[]).map((c) => ({ code: c.code, name: c.name, balance: Number(c.balance) })),
      total: true,
    }),
  },
  "customer-contact-list": {
    path: CUSTOMERS,
    build: (d) => ({
      columns: [{ key: "name", label: "Customer" }, { key: "telephone", label: "Phone" }, { key: "email", label: "Email" }, { key: "physicalAddress", label: "Address" }],
      rows: d as unknown as Row[],
    }),
  },
  "income-by-customer-summary": {
    path: INVOICES,
    build: (d) => ({
      columns: [{ key: "customer", label: "Customer" }, { key: "invoices", label: "Invoices" }, { key: "net", label: "Income", kind: "money" }, { key: "outstanding", label: "Open balance", kind: "money" }],
      rows: groupByCustomer(d),
      total: true,
    }),
  },
  "profit-and-loss-by-customer": {
    path: INVOICES,
    build: (d) => ({
      columns: [{ key: "customer", label: "Customer" }, { key: "net", label: "Income", kind: "money" }],
      rows: groupByCustomer(d),
      total: true,
    }),
  },
  "purchase-list": {
    path: BILLS,
    build: (d) => ({
      columns: [{ key: "billDate", label: "Date", kind: "date" }, { key: "billNumber", label: "Bill" }, { key: "supplierName", label: "Vendor" }, { key: "dueDate", label: "Due date", kind: "date" }, { key: "gross", label: "Amount", kind: "money" }, { key: "outstanding", label: "Open balance", kind: "money" }],
      rows: d as unknown as Row[],
      dateKey: "billDate",
      total: true,
    }),
  },
  "transaction-list-by-vendor": {
    path: BILLS,
    build: (d) => ({
      columns: [{ key: "supplierName", label: "Vendor" }, { key: "billDate", label: "Date", kind: "date" }, { key: "billNumber", label: "Bill" }, { key: "gross", label: "Amount", kind: "money" }, { key: "paid", label: "Paid", kind: "money" }],
      rows: [...(d as ApBill[])].sort((a, b) => a.supplierName.localeCompare(b.supplierName)) as unknown as Row[],
      dateKey: "billDate",
      total: true,
    }),
  },
  "vendor-phone-list": {
    path: SUPPLIERS,
    build: (d) => ({
      columns: [{ key: "name", label: "Vendor" }, { key: "contactPerson", label: "Contact" }, { key: "telephone", label: "Phone" }, { key: "email", label: "Email" }],
      rows: d as Supplier[] as unknown as Row[],
    }),
  },
  "inventory-status": {
    path: "/api/v1/inventory/valuation",
    build: (d) => ({
      columns: [{ key: "name", label: "Item" }, { key: "sku", label: "SKU" }, { key: "location", label: "Location" }, { key: "quantity", label: "On hand" }, { key: "value", label: "Value", kind: "money" }],
      rows: anyRows((d as { lines: Row[] }).lines),
    }),
  },
  "expense-list": { title: "Expenses", path: "/api/v1/expenses?pageSize=200", build: (d) => { const rows = anyRows(d); return { columns: autoColumns(rows), rows, dateKey: "expenseDate" }; } },
  "journal-entries": { title: "Journal entries", path: "/api/v1/journals", build: (d) => { const rows = anyRows(d); return { columns: autoColumns(rows), rows }; } },
  "banking-transactions": { title: "Banking transactions", path: "/api/v1/banking/transactions?pageSize=200", build: (d) => { const rows = anyRows(d); return { columns: autoColumns(rows), rows }; } },
  // QuickBooks Account List: active accounts as "Parent:Child", with balances on balance sheet accounts only.
  "account-list": { title: "Account List", path: "/api/v1/coa?isActive=true", build: (d) => ({ columns: accountListCols, rows: accountListRows(d as Account[]) }) },
};

function Table({ built, title }: { built: Built; title: string }) {
  const { currency } = useCompany();
  const cell = (c: Col, r: Row) => {
    const v = r[c.key];
    if (v === null || v === undefined || v === "") return "—";
    if (c.kind === "money") return amount(Number(v), 2);
    if (c.kind === "date") return date(String(v));
    return String(v);
  };
  if (!built.rows.length) return <EmptyState title="Nothing to show for this report" body="Try a wider date range, or post some transactions first." />;
  return (
    <div className="rp-table-wrap">
      <table className="rp-table rp-table-report" aria-label={title}>
        <thead>
          <tr>
            {built.columns.map((c) => (
              <th key={c.key} className={c.kind === "money" ? "num" : undefined}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {built.rows.map((r, i) => (
            <tr key={i}>
              {built.columns.map((c) => (
                <td key={c.key} className={c.kind === "money" ? "num" : undefined}>
                  {cell(c, r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {built.total && (
          <tfoot>
            <tr>
              {built.columns.map((c, i) => (
                <td key={c.key} className={c.kind === "money" ? "num" : undefined}>
                  {i === 0 ? `Total (${currency})` : c.kind === "money" ? amount(built.rows.reduce((s, r) => s + Number(r[c.key] ?? 0), 0), 2) : ""}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

const SEGMENTS: Array<{ label: string; pick: (m: MonthFigures) => number; strong?: boolean }> = [
  { label: "Income", pick: (m) => m.revenue },
  { label: "Cost of sales", pick: (m) => m.costOfSales },
  { label: "Gross profit", pick: (m) => m.grossProfit, strong: true },
  { label: "Expenses", pick: (m) => m.expenses },
  { label: "Net profit", pick: (m) => m.profit, strong: true },
];

function pnlBuilt(rows: MonthFigures[], mode: "month" | "quarter" | "percent"): { built: Built; strong: string[] } {
  if (mode === "percent") {
    const income = rows.reduce((s, m) => s + m.revenue, 0);
    return {
      strong: ["Gross profit", "Net profit"],
      built: {
        columns: [{ key: "line", label: "Line" }, { key: "total", label: "Total", kind: "money" }, { key: "pct", label: "% of income" }],
        rows: SEGMENTS.map((s) => {
          const total = rows.reduce((a, m) => a + s.pick(m), 0);
          return { line: s.label, total, pct: income ? `${amount((total / income) * 100, 1)}%` : "—" };
        }),
      },
    };
  }
  const groups = mode === "month"
    ? rows.map((m) => ({ key: m.month, label: monthLong(m.month), months: [m] }))
    : [0, 1, 2, 3]
        .map((q) => ({ key: `q${q}`, label: `Q${q + 1}`, months: rows.filter((m) => Math.floor((Number(m.month.slice(5, 7)) - 1) / 3) === q) }))
        .filter((g) => g.months.length);
  return {
    strong: ["Gross profit", "Net profit"],
    built: {
      columns: [{ key: "line", label: "Line" }, ...groups.map((g) => ({ key: g.key, label: g.label, kind: "money" as const })), { key: "total", label: "Total", kind: "money" as const }],
      rows: SEGMENTS.map((s) => ({
        line: s.label,
        ...Object.fromEntries(groups.map((g) => [g.key, g.months.reduce((a, m) => a + s.pick(m), 0)])),
        total: rows.reduce((a, m) => a + s.pick(m), 0),
      })),
    },
  };
}

const PNL_MODES: Record<string, "month" | "quarter" | "percent"> = {
  "profit-and-loss-by-month": "month",
  "quarterly-profit-and-loss-summary": "quarter",
  "profit-and-loss-as-percent-of-total-income": "percent",
};

const TERMS_BUILT: Built = { columns: [{ key: "label", label: "Term" }, { key: "days", label: "Days" }], rows: TERMS.map((t) => ({ label: t.label, days: String(t.days) })) };

function toCsv(title: string, built: Built) {
  const rows = built.rows.map((r) => built.columns.map((c) => r[c.key] as string | number | null | undefined));
  downloadCsv(`${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`, [built.columns.map((c) => c.label), ...rows]);
}

export function ReportViewer({ slug }: { slug: string }) {
  const { query } = useLocation();
  const customerFilter = query.get("customer");
  const { email } = useSession();
  const { toast } = useFeedback();
  const { name: company } = useCompany();

  const saved = useMemo(() => (query.get("saved") ? readLocal<CustomReport>("custom-reports").find((r) => r.id === query.get("saved")) : undefined), [query]);
  const source = SOURCES[slug];
  const pnlMode = PNL_MODES[slug];
  const isTerms = slug === "terms-list";
  const baseTitle = reportNameFor(slug) ?? source?.title ?? query.get("type") ?? humanize(slug.replace(/-/g, "_"));
  const title = saved?.name ?? (customerFilter ? `${baseTitle}: ${customerFilter}` : baseTitle);

  const [from, setFrom] = useState(saved?.from ?? "");
  const [to, setTo] = useState(saved?.to ?? "");
  const [saving, setSaving] = useState(false);
  const [saveName, setSaveName] = useState(baseTitle);
  const [saveError, setSaveError] = useState("");
  useEffect(() => {
    setFrom(saved?.from ?? "");
    setTo(saved?.to ?? "");
  }, [saved]);

  const resource = useResource<unknown>(source?.path ?? null);
  const months = useYearMonths("THIS_YEAR");
  const monthly = useMonthlyFigures(pnlMode ? months : []);

  const built = useMemo<Built | undefined>(() => {
    if (isTerms) return TERMS_BUILT;
    if (pnlMode) return monthly.rows && pnlBuilt(monthly.rows, pnlMode).built;
    if (!source || resource.data === undefined) return undefined;
    const raw = source.build(resource.data);
    // ?customer=<name> (from a customer's profile) narrows customer reports to that customer.
    const b = customerFilter ? { ...raw, rows: raw.rows.filter((r) => (r.customerName ?? r.customer ?? customerFilter) === customerFilter) } : raw;
    if (!b.dateKey || (!from && !to)) return b;
    const key = b.dateKey;
    return { ...b, rows: b.rows.filter((r) => { const d = String(r[key] ?? "").slice(0, 10); return (!from || d >= from) && (!to || d <= to); }) };
  }, [isTerms, pnlMode, monthly.rows, source, resource.data, from, to, customerFilter]);

  const connected = Boolean(source || pnlMode || isTerms);
  const loading = pnlMode ? monthly.loading : source ? resource.loading && resource.data === undefined : false;
  const error = pnlMode ? monthly.error : source ? resource.error : undefined;
  const hasDates = Boolean(built?.dateKey);

  function commit() {
    if (!saveName.trim()) return setSaveError("Give the report a name.");
    const now = new Date().toISOString();
    saveLocal<CustomReport>("custom-reports", { id: saved?.id ?? newId(), name: saveName.trim(), slug, from, to, createdBy: saved?.createdBy ?? email ?? "You", modifiedBy: email ?? "You", updatedAt: now });
    setSaving(false);
    toast("Saved to Custom reports.");
  }

  return (
    <div className="rp-page">
      <PageHeader
        title={title}
        description={`${company} · ${built?.dateKey && (from || to) ? `${from ? date(from) : "Start"} – ${to ? date(to) : date(isoDay())}` : pnlMode ? `January – ${monthLong(months[months.length - 1])}` : `As of ${date(isoDay())}`}`}
        back={{ to: saved ? "/reports/custom" : "/reports/standard", label: saved ? "Custom reports" : "Standard reports" }}
        actions={
          connected ? (
            <>
              <button type="button" className="rp-btn" disabled={!built} onClick={() => built && toCsv(title, built)}>
                <Download size={16} aria-hidden="true" /> Export CSV
              </button>
              <button type="button" className="rp-btn" onClick={() => window.print()}>
                <Printer size={16} aria-hidden="true" /> Print
              </button>
              <button
                type="button"
                className="rp-btn rp-btn-primary"
                onClick={() => {
                  setSaveName(title);
                  setSaveError("");
                  setSaving(true);
                }}
              >
                Save Customisations
              </button>
            </>
          ) : undefined
        }
      />
      {!connected ? (
        <div className="rp-panel">
          <EmptyState
            title="This report isn't connected to data yet"
            body="It's in the report list so you can favourite it, but the accounting API doesn't supply these figures yet."
            action={<Link to="/reports/standard" className="rp-btn">Back to Standard reports</Link>}
          />
        </div>
      ) : (
        <>
          {hasDates && (
            <div className="rp-filter no-print">
              <label className="rp-field">
                <span>From</span>
                <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
              </label>
              <label className="rp-field">
                <span>To</span>
                <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
              </label>
              {(from || to) && (
                <button type="button" className="rp-link" onClick={() => { setFrom(""); setTo(""); }}>
                  Clear dates
                </button>
              )}
            </div>
          )}
          {error ? (
            <ErrorState message={error} onRetry={pnlMode ? monthly.reload : resource.reload} />
          ) : loading || !built ? (
            <SkeletonRows rows={8} cols={5} />
          ) : (
            <Table built={built} title={title} />
          )}
        </>
      )}
      {saving && (
        <Modal
          title="Save Customisations"
          width={480}
          onClose={() => setSaving(false)}
          footer={
            <>
              <button type="button" className="rp-btn" onClick={() => setSaving(false)}>
                Cancel
              </button>
              <button type="button" className="rp-btn rp-btn-primary" onClick={commit}>
                Save
              </button>
            </>
          }
        >
          <label className="rp-field">
            <span>Report name</span>
            <input autoFocus value={saveName} onChange={(e) => setSaveName(e.target.value)} aria-invalid={Boolean(saveError)} />
            {saveError && <small className="rp-error">{saveError}</small>}
          </label>
          <p className="rp-muted">The report is saved privately on this device with its date range.</p>
        </Modal>
      )}
    </div>
  );
}
