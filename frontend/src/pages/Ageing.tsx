import { Printer } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { EmptyState, Field, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date, isoDay } from "../lib/format";
import { Link } from "../lib/router";
import { useResource } from "../lib/session";
import type { AgeingBucket, AgeingReport, ApAgeingReport } from "../lib/types";

type Line = { partyId: string; partyName: string; docNumber: string; dueDate: string; outstanding: number; bucket: string };

const KINDS = {
  ar: {
    endpoint: "/api/v1/ar/ageing",
    title: "Receivables ageing",
    reportTitle: "Aged receivables",
    description: "What customers owe, grouped by how long it's been outstanding past the due date.",
    party: "Customer",
    partyPath: "/customers",
    detailLabel: "{cfg.detailLabel}",
    empty: "No customer owed money as at this date.",
    foot: "Days are counted from each invoice's due date.",
    lines: (r: AgeingReport | ApAgeingReport): Line[] =>
      (r as AgeingReport).lines.map((l) => ({ partyId: l.customerId, partyName: l.customerName, docNumber: l.invoiceNumber, dueDate: l.dueDate, outstanding: l.outstanding, bucket: l.bucket })),
  },
  ap: {
    endpoint: "/api/v1/ap/ageing",
    title: "Payables ageing",
    reportTitle: "Aged payables",
    description: "What you owe suppliers, grouped by how long it's been outstanding past the due date.",
    party: "Supplier",
    partyPath: "/suppliers",
    detailLabel: "Show individual bills",
    empty: "Nothing was owed to suppliers as at this date.",
    foot: "Days are counted from each bill's due date.",
    lines: (r: AgeingReport | ApAgeingReport): Line[] =>
      (r as ApAgeingReport).lines.map((l) => ({ partyId: l.supplierId, partyName: l.supplierName, docNumber: l.billNumber, dueDate: l.dueDate, outstanding: l.outstanding, bucket: l.bucket })),
  },
} as const;

export function AgeingReportPage({ kind = "ar" }: { kind?: keyof typeof KINDS }) {
  const cfg = KINDS[kind];
  const { name, currency } = useCompany();
  const [asOf, setAsOf] = useState(isoDay());
  const [detail, setDetail] = useState(false);
  const report = useResource<{ asOf: string; buckets: AgeingBucket[]; total: number } & (AgeingReport | ApAgeingReport)>(`${cfg.endpoint}?asOf=${asOf}`);

  const parties = useMemo(() => {
    const byParty = new Map<string, { id: string; name: string; buckets: Record<string, number>; total: number; lines: Line[] }>();
    for (const line of report.data ? cfg.lines(report.data) : []) {
      let row = byParty.get(line.partyId);
      if (!row) {
        row = { id: line.partyId, name: line.partyName, buckets: {}, total: 0, lines: [] };
        byParty.set(line.partyId, row);
      }
      row.buckets[line.bucket] = (row.buckets[line.bucket] ?? 0) + line.outstanding;
      row.total += line.outstanding;
      row.lines.push(line);
    }
    return [...byParty.values()].sort((a, b) => b.total - a.total);
  }, [report.data, cfg]);

  const buckets = report.data?.buckets ?? [];
  const cell = (v: number | undefined) => (v ? amount(v) : <span className="subtle">—</span>);

  return (
    <>
      <PageHeader
        title={cfg.title}
        description={cfg.description}
        actions={
          <button type="button" className="btn" onClick={() => window.print()}>
            <Printer size={16} aria-hidden="true" />
            Print
          </button>
        }
      />

      <div className="filter-bar no-print">
        <Field label="As at">
          <input className="input" type="date" value={asOf} max={isoDay()} onChange={(e) => setAsOf(e.target.value || isoDay())} />
        </Field>
        <label className="check" style={{ alignSelf: "flex-end", height: 34 }}>
          <input type="checkbox" checked={detail} onChange={(e) => setDetail(e.target.checked)} />
          {cfg.detailLabel}
        </label>
      </div>

      <Loadable resource={report}>
        {(r) => (
          <div className="report">
            <div className="report-head">
              <div className="company">{name}</div>
              <div className="title">{cfg.reportTitle}</div>
              <div className="period">As at {date(r.asOf)} · Amounts in {currency}</div>
            </div>
            {parties.length === 0 ? (
              <EmptyState title="Nothing outstanding" body={cfg.empty} />
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="table pin-first">
                  <thead>
                    <tr>
                      <th>{cfg.party}</th>
                      {buckets.map((b) => (
                        <th key={b.key} className="num">
                          {b.label}
                        </th>
                      ))}
                      <th className="num">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parties.map((c) => (
                      <Fragment key={c.id}>
                        <tr>
                          <td className={detail ? "strong" : undefined}>
                            <Link to={`${cfg.partyPath}/${c.id}`} style={{ color: "inherit" }}>
                              {c.name}
                            </Link>
                          </td>
                          {buckets.map((b) => (
                            <td key={b.key} className={`num ${b.key !== "CURRENT" && c.buckets[b.key] ? "text-negative" : ""}`}>
                              {cell(c.buckets[b.key])}
                            </td>
                          ))}
                          <td className="num strong">{amount(c.total)}</td>
                        </tr>
                        {detail &&
                          c.lines.map((l) => (
                            <tr key={l.docNumber}>
                              <td className="indent-1 muted">
                                {l.docNumber} · due {date(l.dueDate)}
                              </td>
                              {buckets.map((b) => (
                                <td key={b.key} className="num muted">
                                  {l.bucket === b.key ? amount(l.outstanding) : ""}
                                </td>
                              ))}
                              <td />
                            </tr>
                          ))}
                      </Fragment>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td>Total</td>
                      {buckets.map((b) => (
                        <td key={b.key} className="num">
                          {amount(b.amount)}
                        </td>
                      ))}
                      <td className="num">{amount(r.total)}</td>
                    </tr>
                    <tr>
                      <td className="muted" style={{ fontWeight: 400, borderBottom: 0, borderTop: 0 }}>
                        Share of total
                      </td>
                      {buckets.map((b) => (
                        <td key={b.key} className="num muted" style={{ fontWeight: 400, borderBottom: 0, borderTop: 0 }}>
                          {r.total ? `${Math.round((b.amount / r.total) * 100)}%` : "—"}
                        </td>
                      ))}
                      <td style={{ borderBottom: 0, borderTop: 0 }} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
            <div className="report-foot">
              <span>{cfg.foot}</span>
              <span>Printed {date(new Date())}</span>
            </div>
          </div>
        )}
      </Loadable>
    </>
  );
}
