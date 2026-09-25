import { useState } from "react";
import { EmptyState, Field, Loadable, PageHeader } from "../components/ui";
import { Select } from "../components/Select";
import { useCompany } from "../lib/company";
import { amount, date, isoDay, moduleLabel } from "../lib/format";
import { useResource } from "../lib/session";
import { TAX_TYPE_LABELS } from "../lib/tax";
import type { TaxLedger, TaxType } from "../lib/types";
import { monthStart } from "./WithholdingTax";

export function TaxLedgerPage() {
  const { currency } = useCompany();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(isoDay());
  const [taxType, setTaxType] = useState("");
  const [page, setPage] = useState(1);
  const q = new URLSearchParams({ from, to, page: String(page), pageSize: "50" });
  if (taxType) q.set("taxType", taxType);
  const ledger = useResource<TaxLedger>(`/api/v1/tax/ledger?${q}`);

  return (
    <>
      <PageHeader title="Tax ledger" description="Movements on every tax GL account for the period." back={{ to: "/tax", label: "Tax" }} />
      <div className="filter-bar no-print">
        <Field label="From">
          <input
            className="input"
            type="date"
            value={from}
            max={to}
            onChange={(e) => {
              setFrom(e.target.value || monthStart());
              setPage(1);
            }}
          />
        </Field>
        <Field label="To">
          <input
            className="input"
            type="date"
            value={to}
            min={from}
            onChange={(e) => {
              setTo(e.target.value || isoDay());
              setPage(1);
            }}
          />
        </Field>
        <Field label="Tax type">
          <Select
            value={taxType}
            onChange={(v) => {
              setTaxType(v);
              setPage(1);
            }}
            options={[{ value: "", label: "All types" }, ...Object.entries(TAX_TYPE_LABELS).map(([value, label]) => ({ value, label }))]}
            searchable={false}
          />
        </Field>
      </div>

      <Loadable resource={ledger}>
        {(r) => (
          <div className="panel">
            <div className="panel-head">
              <h2>
                {date(r.from)} – {date(r.to)} · {currency}
              </h2>
              <span className="muted">
                Opening {amount(r.openingBalance)} · Closing {amount(r.closingBalance)}
              </span>
            </div>
            {r.rows.length === 0 ? (
              <EmptyState title="No tax postings" body="Nothing hit a tax account in this period." />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Account</th>
                      <th>Journal</th>
                      <th className="num">Debit</th>
                      <th className="num">Credit</th>
                      <th className="num">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.rows.map((row) => (
                      <tr key={row.id}>
                        <td className="nowrap">{date(row.date)}</td>
                        <td>{TAX_TYPE_LABELS[row.taxType as TaxType] ?? row.taxType}</td>
                        <td>
                          {row.accountCode}
                          <span className="sub">{row.accountName}</span>
                        </td>
                        <td>
                          {row.journalNumber}
                          <span className="sub">
                            {moduleLabel(row.sourceModule)}
                            {row.reference ? ` · ${row.reference}` : ""}
                          </span>
                        </td>
                        <td className="num">{row.debit ? amount(row.debit) : ""}</td>
                        <td className="num">{row.credit ? amount(row.credit) : ""}</td>
                        <td className="num">{amount(row.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {r.total > r.pageSize && (
              <div className="pager">
                <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </button>
                <span className="muted">
                  Page {r.page} of {Math.ceil(r.total / r.pageSize)}
                </span>
                <button type="button" className="btn" disabled={page * r.pageSize >= r.total} onClick={() => setPage((p) => p + 1)}>
                  Next
                </button>
              </div>
            )}
          </div>
        )}
      </Loadable>
    </>
  );
}
