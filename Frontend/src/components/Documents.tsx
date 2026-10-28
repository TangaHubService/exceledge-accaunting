import { Download, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useCompany } from "../lib/company";
import { amount, date, humanize, isoDay } from "../lib/format";
import { useResource, useSession } from "../lib/session";
import type { AccountType, PeriodStatement, TaxCode, TaxType } from "../lib/types";
import { accountOptions } from "../pages/Accounts";
import { type Column, DataTable } from "./DataTable";
import { useFeedback } from "./feedback";
import { MoneyInput, parseAmount, SummaryRows } from "./forms";
import { Select } from "./Select";
import { EmptyState, Loadable } from "./ui";

/* ── Line items ────────────────────────────────────────── */

export type LineDraft = { description: string; quantity: string; unitPrice: string; discount: string; taxCode: string; accountId: string };

export const emptyLine = (taxCode = ""): LineDraft => ({ description: "", quantity: "1", unitPrice: "", discount: "", taxCode, accountId: "" });

const SIDE_TAX_TYPES: Record<"sales" | "purchase", TaxType[]> = {
  sales: ["OUTPUT_VAT", "ZERO_RATED", "EXEMPT", "EXCISE"],
  purchase: ["INPUT_VAT", "IMPORT_VAT", "ZERO_RATED", "EXEMPT", "EXCISE"],
};

const SIDE_ACCOUNT_TYPES: Record<"sales" | "purchase", AccountType[]> = {
  sales: ["INCOME", "OTHER_INCOME"],
  purchase: ["COST_OF_SALES", "EXPENSE", "OTHER_EXPENSE", "ASSET"],
};

const cents = (n: number) => Math.round(n * 100) / 100;

/** Same pricing as the server: line net and tax are rounded to the cent, line by line. */
export function priceLines(lines: LineDraft[], codes: TaxCode[]) {
  let net = 0;
  let tax = 0;
  const priced = lines.map((l) => {
    const q = parseAmount(l.quantity);
    const p = parseAmount(l.unitPrice);
    const d = parseAmount(l.discount) || 0;
    const lineNet = Number.isFinite(q) && Number.isFinite(p) ? cents(q * p - d) : 0;
    const rate = l.taxCode ? Number(codes.find((c) => c.code === l.taxCode)?.ratePercent ?? 0) : 0;
    const lineTax = cents((lineNet * rate) / 100);
    net += lineNet;
    tax += lineTax;
    return { net: lineNet, tax: lineTax };
  });
  return { priced, net: cents(net), tax: cents(tax), gross: cents(net + tax) };
}

export function linesPayload(lines: LineDraft[]) {
  return lines.map((l) => ({
    description: l.description.trim(),
    quantity: parseAmount(l.quantity),
    unitPrice: parseAmount(l.unitPrice),
    discount: parseAmount(l.discount) || undefined,
    taxCode: l.taxCode || undefined,
    accountId: l.accountId || undefined,
  }));
}

/** Active tax codes usable on this side; empty when the user can't read tax settings. */
export function useLineTaxCodes(side: "sales" | "purchase") {
  const { can } = useSession();
  const codes = useResource<TaxCode[]>(can("tax:view") ? "/api/v1/tax/codes" : null);
  return useMemo(() => (codes.data ?? []).filter((c) => c.isActive && SIDE_TAX_TYPES[side].includes(c.taxType)), [codes.data, side]);
}

export function LineItemsEditor({
  lines,
  onChange,
  side,
  codes,
  currency,
}: {
  lines: LineDraft[];
  onChange: (lines: LineDraft[]) => void;
  side: "sales" | "purchase";
  codes: TaxCode[];
  currency: string;
}) {
  const { accounts } = useCompany();
  const accountChoices = useMemo(
    () => [
      { value: "", label: side === "sales" ? "Default sales account" : "Default expense account" },
      ...accountOptions(accounts.filter((a) => a.isActive && SIDE_ACCOUNT_TYPES[side].includes(a.type))),
    ],
    [accounts, side],
  );
  const taxChoices = [{ value: "", label: "No tax" }, ...codes.map((c) => ({ value: c.code, label: c.code, hint: `${Number(c.ratePercent)}% · ${c.name}` }))];
  const totals = priceLines(lines, codes);
  const set = (i: number, key: keyof LineDraft, value: string) => onChange(lines.map((l, j) => (j === i ? { ...l, [key]: value } : l)));

  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Description</th>
              <th className="num" style={{ width: 70 }}>
                Qty
              </th>
              <th className="num" style={{ width: 120 }}>
                Unit price
              </th>
              <th className="num" style={{ width: 100 }}>
                Discount
              </th>
              <th style={{ width: 130 }}>Tax code</th>
              <th style={{ width: 180 }}>Account</th>
              <th className="num" style={{ width: 110 }}>
                Net
              </th>
              <th style={{ width: 36 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td style={{ padding: "5px 8px" }}>
                  <input className="input" value={l.description} onChange={(e) => set(i, "description", e.target.value)} aria-label={`Line ${i + 1} description`} required />
                </td>
                <td style={{ padding: "5px 8px" }}>
                  <input
                    className="input num"
                    inputMode="decimal"
                    value={l.quantity}
                    onChange={(e) => set(i, "quantity", e.target.value.replace(/[^\d.]/g, ""))}
                    aria-label={`Line ${i + 1} quantity`}
                    required
                  />
                </td>
                <td style={{ padding: "5px 8px" }}>
                  <MoneyInput value={l.unitPrice} onChange={(v) => set(i, "unitPrice", v)} aria-label={`Line ${i + 1} unit price`} required />
                </td>
                <td style={{ padding: "5px 8px" }}>
                  <MoneyInput value={l.discount} onChange={(v) => set(i, "discount", v)} placeholder="0" aria-label={`Line ${i + 1} discount`} />
                </td>
                <td style={{ padding: "5px 8px" }}>
                  {codes.length ? (
                    <Select value={l.taxCode} onChange={(v) => set(i, "taxCode", v)} options={taxChoices} />
                  ) : (
                    <input className="input" value={l.taxCode} onChange={(e) => set(i, "taxCode", e.target.value.toUpperCase())} placeholder="e.g. VAT18" aria-label={`Line ${i + 1} tax code`} />
                  )}
                </td>
                <td style={{ padding: "5px 8px" }}>
                  <Select value={l.accountId} onChange={(v) => set(i, "accountId", v)} options={accountChoices} searchable />
                </td>
                <td className="num">{amount(totals.priced[i].net, 2)}</td>
                <td>
                  {lines.length > 1 && (
                    <button type="button" className="icon-button" aria-label={`Remove line ${i + 1}`} onClick={() => onChange(lines.filter((_, j) => j !== i))}>
                      <X size={15} aria-hidden="true" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => onChange([...lines, emptyLine(lines[lines.length - 1]?.taxCode)])} disabled={lines.length >= 200}>
        <Plus size={14} aria-hidden="true" />
        Add line
      </button>
      <SummaryRows
        rows={[
          ["Amount before tax", amount(totals.net, 2)],
          ["Tax", amount(totals.tax, 2)],
          [`Total (${currency})`, amount(totals.gross, 2), true],
        ]}
      />
    </>
  );
}

/** Two-way switch between a single amount and line items. */
export function EntryModeSwitch({ lined, onChange }: { lined: boolean; onChange: (lined: boolean) => void }) {
  return (
    <div className="segmented" role="group" aria-label="How to enter amounts" style={{ marginTop: 22 }}>
      <button type="button" className={lined ? "" : "on"} onClick={() => onChange(false)}>
        Single amount
      </button>
      <button type="button" className={lined ? "on" : ""} onClick={() => onChange(true)}>
        Line items
      </button>
    </div>
  );
}

/* ── PDF downloads ─────────────────────────────────────── */

export function PdfButton({ path, filename, label = "PDF", className = "btn btn-sm" }: { path: string; filename: string; label?: string; className?: string }) {
  const { download } = useSession();
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`${className} no-print`}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        setBusy(true);
        download(path, filename)
          .catch((err: Error) => toast(err.message, { error: true }))
          .finally(() => setBusy(false));
      }}
    >
      <Download size={14} aria-hidden="true" />
      {busy ? "Preparing…" : label}
    </button>
  );
}

/* ── Period statement ──────────────────────────────────── */

const firstOfMonth = () => `${isoDay().slice(0, 8)}01`;

export function PeriodStatementView({ kind, partyId, partyCode }: { kind: "customer" | "supplier"; partyId: string; partyCode: string }) {
  const { currency } = useCompany();
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(isoDay);
  const base = kind === "customer" ? `/api/v1/ar/customers/${partyId}` : `/api/v1/ap/suppliers/${partyId}`;
  const range = `from=${from}&to=${to}`;
  const valid = Boolean(from && to && from <= to);
  const statement = useResource<PeriodStatement>(valid ? `${base}/period-statement?${range}` : null);
  type Entry = PeriodStatement["entries"][number];
  const charged = kind === "customer" ? "Charged" : "Paid / credited";
  const paid = kind === "customer" ? "Paid / credited" : "Billed";

  const columns: Column<Entry>[] = [
    { key: "date", header: "Date", className: "nowrap", render: (e) => date(e.entryDate) },
    {
      key: "doc",
      header: "Transaction",
      render: (e) => (
        <>
          {humanize(e.docType)} <span className="muted">{e.docNumber}</span>
          {e.description && <span className="sub">{e.description}</span>}
        </>
      ),
    },
    { key: "debit", header: charged, numeric: true, render: (e) => (e.debit ? amount(e.debit, 2) : "") },
    { key: "credit", header: paid, numeric: true, render: (e) => (e.credit ? amount(e.credit, 2) : "") },
    { key: "balance", header: `Balance (${currency})`, numeric: true, render: (e) => <span className="strong">{amount(e.balance, 2)}</span> },
  ];

  return (
    <>
      <div className="filter-bar">
        <label className="field" style={{ margin: 0 }}>
          <span className="field-label">From</span>
          <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="field" style={{ margin: 0 }}>
          <span className="field-label">To</span>
          <input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        {valid && (
          <PdfButton
            path={`${base}/statement.pdf?${range}`}
            filename={`${kind === "supplier" ? "supplier-" : ""}statement-${partyCode}-${from}-${to}.pdf`}
            label="Download PDF"
            className="btn"
          />
        )}
      </div>
      {!valid && <p className="field-error">The start date must be on or before the end date.</p>}
      {valid && (
        <Loadable resource={statement}>
          {(s) => (
            <DataTable
              columns={columns}
              rows={s.entries}
              rowKey={(e) => e.id}
              empty={<EmptyState title="No activity in this period" body={`The balance stayed at ${currency} ${amount(s.openingBalance, 2)}.`} />}
              footer={
                <>
                  <tr>
                    <td colSpan={4}>Balance brought forward ({s.from})</td>
                    <td className="num">{amount(s.openingBalance, 2)}</td>
                  </tr>
                  <tr>
                    <td colSpan={4}>Closing balance ({s.to})</td>
                    <td className="num strong">{amount(s.closingBalance, 2)}</td>
                  </tr>
                </>
              }
            />
          )}
        </Loadable>
      )}
    </>
  );
}
