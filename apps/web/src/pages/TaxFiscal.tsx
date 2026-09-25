import { useState } from "react";
import { EmptyState, Field, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, dateTime, isoDay } from "../lib/format";
import { useResource } from "../lib/session";
import type { FiscalDocumentList } from "../lib/types";
import { monthStart } from "./WithholdingTax";

export function TaxFiscal() {
  const { currency } = useCompany();
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(isoDay());
  const docs = useResource<FiscalDocumentList>(`/api/v1/tax/fiscal-documents?from=${from}&to=${to}&pageSize=100`);

  return (
    <>
      <PageHeader
        title="Fiscal documents"
        description="EBM fiscal invoice details recorded from Excel Edge sales. Transmission stays in Excel Edge — Accounting only stores the link."
        back={{ to: "/tax", label: "Tax" }}
      />
      <div className="filter-bar no-print">
        <Field label="From">
          <input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value || monthStart())} />
        </Field>
        <Field label="To">
          <input className="input" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value || isoDay())} />
        </Field>
      </div>

      <Loadable resource={docs}>
        {(d) =>
          d.rows.length === 0 ? (
            <div className="panel">
              <EmptyState title="No fiscal documents" body="When Excel Edge completes a fiscal sale, the receipt details appear here." />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Document</th>
                    <th className="hide-sm">SDC receipt</th>
                    <th className="num">Net</th>
                    <th className="num">Tax</th>
                    <th className="num">Gross ({currency})</th>
                  </tr>
                </thead>
                <tbody>
                  {d.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="nowrap">{dateTime(r.occurredAt)}</td>
                      <td>
                        {r.sourceDocumentNumber || r.sourceDocumentId}
                        <span className="sub">{r.sourceDocumentType}</span>
                      </td>
                      <td className="hide-sm">
                        {r.sdcReceiptNumber || "—"}
                        {r.vsdcInvoiceNumber != null && <span className="sub">VSDC {r.vsdcInvoiceNumber}</span>}
                      </td>
                      <td className="num">{amount(r.netAmount)}</td>
                      <td className="num">{amount(r.taxAmount)}</td>
                      <td className="num">{amount(r.grossAmount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3}>Page total ({d.total} document{d.total === 1 ? "" : "s"})</td>
                    <td className="num">{amount(d.totals.net)}</td>
                    <td className="num">{amount(d.totals.tax)}</td>
                    <td className="num strong">{amount(d.totals.gross)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        }
      </Loadable>
    </>
  );
}
