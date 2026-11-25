import { X } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "../components/feedback";
import { Link } from "../lib/router";
import { useSession } from "../lib/session";
import { isoDay } from "../lib/format";

type Item = { id: string; title: string; path: (from: string, to: string) => string; file: string };
const range = (from: string, to: string) => `${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`;

const REPORTS: Item[] = [
  { id: "statements", title: "Profit and loss, balance sheet and cash flow", path: (f, t) => `/api/v1/books/statements?format=xlsx${range(f, t)}`, file: "financial-statements.xlsx" },
  { id: "trial-balance", title: "Trial balance", path: (f, t) => `/api/v1/books/trial-balance?mode=COLUMNS&format=xlsx${range(f, t)}`, file: "trial-balance.xlsx" },
  { id: "receivables", title: "Receivables ageing", path: (_f, t) => `/api/v1/ar/ageing?format=xlsx${t ? `&asOf=${t}` : ""}`, file: "receivables-ageing.xlsx" },
  { id: "payables", title: "Payables ageing", path: (_f, t) => `/api/v1/ap/ageing?format=xlsx${t ? `&asOf=${t}` : ""}`, file: "payables-ageing.xlsx" },
  { id: "vat", title: "VAT report", path: (f, t) => `/api/v1/tax/reports/vat?format=xlsx${range(f, t)}`, file: "vat.xlsx" },
];
const LISTS: Item[] = [
  { id: "customers", title: "Customers", path: () => "/api/v1/ar/customers/export.csv", file: "customers.csv" },
  { id: "suppliers", title: "Suppliers", path: () => "/api/v1/ap/suppliers/export.csv", file: "suppliers.csv" },
  { id: "items", title: "Products and services", path: () => "/api/v1/inventory/items/export.csv", file: "products-and-services.csv" },
  { id: "accounts", title: "Chart of accounts", path: () => "/api/v1/coa/export?format=csv", file: "chart-of-accounts.csv" },
];

export function ExportData() {
  const { download } = useSession();
  const { toast } = useFeedback();
  const [tab, setTab] = useState<"reports" | "lists">("reports");
  const [from, setFrom] = useState(`${isoDay().slice(0, 4)}-01-01`);
  const [to, setTo] = useState(isoDay());
  const [off, setOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const items = tab === "reports" ? REPORTS : LISTS;
  const chosen = items.filter((i) => !off.has(i.id));

  async function run() {
    setBusy(true);
    const failed: string[] = [];
    for (const item of chosen) {
      try {
        await download(item.path(from, to), item.file);
      } catch (e) {
        failed.push(`${item.title}: ${(e as Error).message}`);
      }
    }
    setBusy(false);
    if (failed.length) toast(failed.join(" "), { error: true });
    else toast(`${chosen.length} file${chosen.length === 1 ? "" : "s"} downloaded`);
  }

  return (
    <div className="ee-export-workspace">
      <div className="ee-export-head">
        <h1 className="ee-export-title">Export data</h1>
        <button type="button" className="ee-export-close-btn" aria-label="Close" onClick={() => window.history.back()}>
          <X size={22} />
        </button>
      </div>
      <h2 className="ee-export-question">Which reports and lists do you want to export?</h2>
      <p className="ee-export-helper">Each one downloads as its own file: reports as Excel workbooks, lists as CSV.</p>
      <div className="ee-export-tabs" role="tablist">
        {(["reports", "lists"] as const).map((t) => (
          <button key={t} type="button" role="tab" aria-selected={tab === t} className={`ee-export-tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t === "reports" ? "Reports" : "Lists"}
          </button>
        ))}
      </div>
      <div className="ee-export-controls-bar">
        {tab === "reports" ? (
          <div style={{ display: "flex", gap: 12 }}>
            <label>
              <div className="ee-export-date-label">From</div>
              <input className="ee-export-date-select" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              <div className="ee-export-date-label">To</div>
              <input className="ee-export-date-select" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
        ) : (
          <span />
        )}
        <Link to="/reports/standard" className="ee-export-more-link">
          For more reports, visit the reports page
        </Link>
      </div>
      <div className="ee-export-card-list">
        {items.map((item) => (
          <div key={item.id} className="ee-export-card">
            <span className="ee-export-card-name">{item.title}</span>
            <label className="ee-switch" aria-label={`Export ${item.title}`}>
              <input
                type="checkbox"
                checked={!off.has(item.id)}
                onChange={() => setOff((s) => (s.has(item.id) ? new Set([...s].filter((x) => x !== item.id)) : new Set([...s, item.id])))}
              />
              <span className="ee-slider" />
            </label>
          </div>
        ))}
      </div>
      <footer className="ee-export-bottom-bar">
        <button type="button" className="ee-btn-outline" onClick={() => window.history.back()}>
          Cancel
        </button>
        <button type="button" className="ee-btn-blue" onClick={() => void run()} disabled={busy || !chosen.length}>
          {busy ? "Exporting…" : "Export"}
        </button>
      </footer>
    </div>
  );
}
