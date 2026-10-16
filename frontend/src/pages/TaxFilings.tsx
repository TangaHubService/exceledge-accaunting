import { Plus } from "lucide-react";
import { useState } from "react";
import { FileFilingForm, PrepareFilingForm } from "../components/TaxForms";
import { useFeedback } from "../components/feedback";
import { Badge, EmptyState, Loadable, PageHeader } from "../components/ui";
import { amount, date } from "../lib/format";
import { useResource, useSession } from "../lib/session";
import { FILING_KIND_LABELS, FILING_STATUS } from "../lib/tax";
import type { TaxFiling } from "../lib/types";

function summaryLine(f: TaxFiling): string {
  const s = f.summary;
  if (!s || typeof s !== "object") return "—";
  if ("net" in s && typeof s.net === "number") return `Net ${amount(s.net)}`;
  if ("totalWithheld" in s && typeof s.totalWithheld === "number") return `Withheld ${amount(s.totalWithheld)}`;
  return "—";
}

export function TaxFilings() {
  const { can, api } = useSession();
  const { confirm, toast } = useFeedback();
  const filings = useResource<TaxFiling[]>("/api/v1/tax/filings");
  const [prepare, setPrepare] = useState(false);
  const [filing, setFiling] = useState<TaxFiling | null>(null);

  async function discard(f: TaxFiling) {
    const ok = await confirm({
      title: `Discard ${f.number}?`,
      body: "Prepared returns that haven't been filed can be removed.",
      confirmLabel: "Discard",
      danger: true,
    });
    if (!ok) return;
    try {
      await api(`/api/v1/tax/filings/${f.id}`, { method: "DELETE" });
      toast("Filing discarded");
      filings.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  return (
    <>
      <PageHeader
        title="Tax filings"
        description="Prepare returns from the books, then mark them filed when submitted to the authority."
        back={{ to: "/tax", label: "Tax" }}
        actions={
          can("tax:manage") && (
            <button type="button" className="btn btn-primary" onClick={() => setPrepare(true)}>
              <Plus size={16} aria-hidden="true" />
              Prepare return
            </button>
          )
        }
      />
      {prepare && (
        <PrepareFilingForm
          onClose={() => setPrepare(false)}
          onSaved={() => {
            setPrepare(false);
            filings.reload();
          }}
        />
      )}
      {filing && (
        <FileFilingForm
          filing={filing}
          onClose={() => setFiling(null)}
          onSaved={() => {
            setFiling(null);
            filings.reload();
          }}
        />
      )}

      <Loadable resource={filings}>
        {(rows) =>
          rows.length === 0 ? (
            <div className="panel">
              <EmptyState title="No filings yet" body="Prepare a VAT or withholding return when the period is closed for filing." />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Return</th>
                    <th>Kind</th>
                    <th>Period</th>
                    <th className="hide-sm">Due</th>
                    <th>Summary</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((f) => (
                    <tr key={f.id}>
                      <td>
                        {f.number}
                        {f.filingReference && <span className="sub">{f.filingReference}</span>}
                      </td>
                      <td>{FILING_KIND_LABELS[f.kind]}</td>
                      <td className="nowrap">
                        {date(f.periodFrom)} – {date(f.periodTo)}
                      </td>
                      <td className="hide-sm nowrap">{f.dueDate ? date(f.dueDate) : "—"}</td>
                      <td>{summaryLine(f)}</td>
                      <td>
                        <Badge tone={FILING_STATUS[f.status].tone}>{FILING_STATUS[f.status].label}</Badge>
                      </td>
                      <td className="num nowrap">
                        {f.status === "PREPARED" && can("tax:file") && (
                          <button type="button" className="btn" onClick={() => setFiling(f)}>
                            Mark filed
                          </button>
                        )}
                        {f.status !== "FILED" && can("tax:manage") && (
                          <button type="button" className="btn" onClick={() => void discard(f)}>
                            Discard
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        }
      </Loadable>
    </>
  );
}
