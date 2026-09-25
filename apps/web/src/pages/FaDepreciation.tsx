import { Calculator } from "lucide-react";
import { useState } from "react";
import { DepreciationRunForm } from "../components/FaForms";
import { EmptyState, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, date } from "../lib/format";
import { useResource, useSession } from "../lib/session";

type Run = { id: string; period: string; assetCount: number; totalAmount: number; journalId: string | null; postedAt: string };
type Schedule = { total: number; rows: Array<{ id: string; period: string; amount: number; assetNumber: string; assetName: string }> };

export function FaDepreciation() {
  const { can } = useSession();
  const { currency } = useCompany();
  const runs = useResource<Run[]>("/api/v1/fixed-assets/depreciation/runs");
  const schedule = useResource<Schedule>("/api/v1/fixed-assets/reports/depreciation");
  const [open, setOpen] = useState(false);

  return (
    <>
      <PageHeader
        title="Depreciation"
        description="Preview and post monthly depreciation. Straight-line and reducing-balance charges update accumulated depreciation and expense."
        actions={
          can("fa:post") && (
            <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
              <Calculator size={16} aria-hidden="true" />
              Run depreciation
            </button>
          )
        }
      />
      {open && (
        <DepreciationRunForm
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            runs.reload();
            schedule.reload();
          }}
        />
      )}

      <div className="overview-grid">
        <section>
          <h2 className="section-title">Posted runs</h2>
          <Loadable resource={runs}>
            {(rows) =>
              rows.length === 0 ? (
                <EmptyState title="No depreciation runs yet" body="Post the first monthly run when assets are in service." />
              ) : (
                <div className="panel">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th className="num">Assets</th>
                        <th className="num">Total</th>
                        <th>Posted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id}>
                          <td>{r.period}</td>
                          <td className="num">{r.assetCount}</td>
                          <td className="num">{amount(r.totalAmount)}</td>
                          <td>{date(r.postedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </Loadable>
        </section>

        <section>
          <h2 className="section-title">Schedule</h2>
          <Loadable resource={schedule}>
            {(s) =>
              s.rows.length === 0 ? (
                <p className="all-clear panel">No depreciation lines yet.</p>
              ) : (
                <div className="panel">
                  <p className="muted" style={{ marginBottom: 8 }}>
                    Total posted {amount(s.total)} {currency}
                  </p>
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Period</th>
                        <th>Asset</th>
                        <th className="num">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.rows.slice(0, 40).map((r) => (
                        <tr key={r.id}>
                          <td>{r.period}</td>
                          <td>
                            {r.assetNumber}
                            <span className="sub">{r.assetName}</span>
                          </td>
                          <td className="num">{amount(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }
          </Loadable>
        </section>
      </div>
    </>
  );
}
