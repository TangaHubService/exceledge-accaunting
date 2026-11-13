import { Download, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useFeedback } from "../components/feedback";
import { Select } from "../components/Select";
import { Badge, PageHeader } from "../components/ui";
import { plural } from "../lib/format";
import { navigate } from "../lib/router";
import { useSession } from "../lib/session";
import type { CustomerImportResult } from "../lib/types";

/** Fields the import endpoint accepts, with the header spellings we recognise automatically. */
const FIELDS: Array<{ key: string; label: string; aliases: string[]; number?: boolean }> = [
  { key: "name", label: "Display name *", aliases: ["display name", "name", "customer", "customer name", "full name"] },
  { key: "companyName", label: "Company", aliases: ["company", "company name", "business"] },
  { key: "email", label: "Email", aliases: ["email", "e-mail", "email address"] },
  { key: "telephone", label: "Phone", aliases: ["phone", "telephone", "phone number", "tel"] },
  { key: "mobile", label: "Mobile", aliases: ["mobile", "cell", "mobile number"] },
  { key: "contactPerson", label: "Contact person", aliases: ["contact", "contact person"] },
  { key: "website", label: "Website", aliases: ["website", "web"] },
  { key: "tin", label: "TIN", aliases: ["tin", "tax id", "vat", "tax number"] },
  { key: "physicalAddress", label: "Billing address", aliases: ["address", "billing address", "street"] },
  { key: "shippingAddress", label: "Shipping address", aliases: ["shipping address"] },
  { key: "country", label: "Country", aliases: ["country"] },
  { key: "creditPeriodDays", label: "Terms (days)", aliases: ["terms", "terms (days)", "credit days", "payment terms"], number: true },
  { key: "creditLimit", label: "Credit limit", aliases: ["credit limit", "limit"], number: true },
  { key: "openingBalance", label: "Opening balance", aliases: ["opening balance", "balance", "open balance"], number: true },
  { key: "openingBalanceDate", label: "Opening balance date", aliases: ["opening balance date", "as of", "balance date"] },
  { key: "notes", label: "Notes", aliases: ["notes", "note", "memo"] },
];

/** RFC 4180-ish CSV: quoted fields, doubled quotes, CRLF or LF. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function guess(header: string) {
  const h = header.trim().toLowerCase();
  return FIELDS.find((f) => f.aliases.includes(h))?.key ?? "";
}

function templateCsv() {
  const head = FIELDS.map((f) => f.label.replace(" *", "")).join(",");
  return `${head}\r\nKigali Traders Ltd,Kigali Traders Ltd,accounts@example.rw,+250788000000,,Jane Doe,,123456789,"KN 4 Ave, Kigali",,Rwanda,30,500000,0,,\r\n`;
}

export function ImportCustomers() {
  const { api } = useSession();
  const { toast } = useFeedback();
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [table, setTable] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<string[]>([]);
  const [result, setResult] = useState<CustomerImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const headers = table[0] ?? [];
  const body = table.slice(1);
  const mappedName = mapping.includes("name");

  const rows = useMemo(
    () =>
      body.map((cells) => {
        const out: Record<string, string | number> = {};
        mapping.forEach((key, i) => {
          if (!key) return;
          // Our own export prefixes = + - @ with an apostrophe so Excel won't run them; undo that here.
          const raw = (cells[i] ?? "").trim().replace(/^'(?=[=+\-@])/, "");
          if (!raw) return;
          const field = FIELDS.find((f) => f.key === key);
          if (field?.number) {
            const n = Number(raw.replace(/[,\s]/g, ""));
            if (Number.isFinite(n)) out[key] = key === "creditPeriodDays" ? Math.round(n) : n;
          } else out[key] = raw;
        });
        return out;
      }),
    [body, mapping],
  );

  async function onFile(file: File) {
    setError("");
    setResult(null);
    if (!/\.csv$/i.test(file.name)) return setError("Choose a .csv file. In Excel, use File → Save As → CSV.");
    if (file.size > 5 * 1024 * 1024) return setError("The file is larger than 5 MB. Split it into smaller files.");
    const parsed = parseCsv(await file.text());
    if (parsed.length < 2) return setError("The file needs a header row and at least one customer.");
    if (parsed.length - 1 > 2000) return setError("Import at most 2,000 customers at a time.");
    setFileName(file.name);
    setTable(parsed);
    setMapping(parsed[0].map(guess));
  }

  async function send(dryRun: boolean) {
    setBusy(true);
    setError("");
    try {
      const res = await api<CustomerImportResult>("/api/v1/ar/customers/import", { method: "POST", body: JSON.stringify({ dryRun, rows }) });
      setResult(res);
      if (!dryRun) toast(`${plural(res.succeeded, "customer")} imported${res.failed ? `, ${res.failed} skipped` : ""}`, res.failed ? { error: true } : undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function downloadTemplate() {
    const url = URL.createObjectURL(new Blob([templateCsv()], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "customers-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const imported = result && !result.dryRun;

  return (
    <div className="cust-import">
      <PageHeader title="Import customers" back={{ to: "/customers", label: "Customers" }} description="Upload a CSV, match its columns, check it, then import. Each row is saved on its own, so one bad row doesn't stop the rest." />

      {error && (
        <div className="notice error" role="alert" style={{ marginBottom: 16 }}>
          {error}
        </div>
      )}

      <section className="panel panel-body cust-import-step">
        <h3>1. Upload a CSV file</h3>
        <div className="cust-import-upload">
          <button type="button" className="btn" onClick={() => input.current?.click()}>
            <Upload size={15} aria-hidden="true" /> {fileName ? "Choose another file" : "Choose CSV file"}
          </button>
          {fileName && (
            <span className="muted">
              {fileName} · {plural(body.length, "row")}
            </span>
          )}
          <span className="grow" />
          <button type="button" className="btn btn-quiet btn-sm" onClick={downloadTemplate}>
            <Download size={14} aria-hidden="true" /> Download template
          </button>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </section>

      {headers.length > 0 && !imported && (
        <section className="panel panel-body cust-import-step">
          <h3>2. Match columns</h3>
          <p className="muted small">We matched what we could. Pick "Don't import" for columns you don't need.</p>
          <div className="cust-map">
            {headers.map((h, i) => (
              <div key={`${h}-${i}`} className="cust-map-row">
                <span className="cust-map-src">
                  <strong>{h || `Column ${i + 1}`}</strong>
                  <span className="sub">{body[0]?.[i] || "—"}</span>
                </span>
                <Select
                  aria-label={`Field for ${h}`}
                  value={mapping[i] ?? ""}
                  searchable={false}
                  onChange={(v) => {
                    setResult(null);
                    setMapping((m) => m.map((x, j) => (j === i ? v : x === v && v ? "" : x)));
                  }}
                  options={[{ value: "", label: "Don't import" }, ...FIELDS.map((f) => ({ value: f.key, label: f.label }))]}
                />
              </div>
            ))}
          </div>
          {!mappedName && <p className="text-negative small">Match a column to Display name to continue.</p>}
          <div className="cust-import-actions">
            <button type="button" className="btn" disabled={!mappedName || busy} onClick={() => void send(true)}>
              {busy ? "Checking…" : "Check file"}
            </button>
            <button type="button" className="btn btn-primary" disabled={!mappedName || busy || !result || result.succeeded === 0} onClick={() => void send(false)}>
              {result?.dryRun ? `Import ${plural(result.succeeded, "customer")}` : "Import"}
            </button>
          </div>
        </section>
      )}

      {result && (
        <section className="panel panel-body cust-import-step">
          <h3>{result.dryRun ? "3. Check results" : "Import finished"}</h3>
          <p>
            <Badge tone="positive">{result.succeeded} {result.dryRun ? "ready" : "imported"}</Badge>{" "}
            {result.failed > 0 && <Badge tone="negative">{result.failed} with problems</Badge>}
          </p>
          {result.failed > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Row</th>
                    <th>Name</th>
                    <th>Problem</th>
                  </tr>
                </thead>
                <tbody>
                  {result.results
                    .filter((r) => !r.ok)
                    .map((r) => (
                      <tr key={r.row}>
                        <td className="num">{r.row}</td>
                        <td>{r.name || <span className="subtle">—</span>}</td>
                        <td className="text-negative">{r.error}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
          {result.dryRun && result.failed > 0 && <p className="muted small">Rows with problems are skipped. Fix them in the file and import again later.</p>}
          {imported && (
            <div className="cust-import-actions">
              <button type="button" className="btn btn-primary" onClick={() => navigate("/customers")}>
                Go to customers
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
