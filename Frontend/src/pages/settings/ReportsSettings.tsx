import { ChevronDown, Info } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "../../components/feedback";
import { SettingsToggle } from "../../components/settings/SettingsToggle";
import { useCompany } from "../../lib/company";
import { type Prefs, usePreferences } from "../../lib/preferences";
import { SettingsLayout } from "../../components/settings/SettingsLayout";
import { REPORT_FORMATTING, REPORT_VISUAL, SAMPLE_PNL_ROWS } from "../../lib/settings-dummy";

const DEFAULTS: Prefs = { header: true, footer: true, column: false, banded: false, empty: false, grid: true, number: "1,234", view: "Comfortable" };
const CHOICES: Record<string, string[]> = { number: ["1,234", "1,234.00", "Thousands"], view: ["Comfortable", "Compact"] };

export function ReportsSettings() {
  const { toast } = useFeedback();
  const company = useCompany();
  const prefs = usePreferences("reports", DEFAULTS);
  const [draft, setDraft] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState(false);
  const look = draft ?? prefs.values;
  const set = (key: string, value: string | boolean) => setDraft({ ...look, [key]: value });
  async function save() {
    if (!draft) return;
    setBusy(true);
    try {
      await prefs.save(draft);
      setDraft(null);
      toast("Report settings saved");
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBusy(false);
    }
  }
  function figure(total: string) {
    if (!total) return look.empty ? "—" : "";
    if (look.number === "1,234.00") return `${total}.00`;
    return look.number === "Thousands" ? Math.round(Number(total.replace(/,/g, "")) / 1000).toLocaleString("en") : total;
  }
  const [open, setOpen] = useState<string | null>(null);

  function toggle(id: string) {
    setOpen((cur) => (cur === id ? null : id));
  }

  return (
    <SettingsLayout
      title="Reports"
      subtitle="Customise the appearance of your financial reports."
      footer={
        <footer className="ee-settings-actions-bar">
          <button type="button" className="btn ee-btn-outline-blue" disabled={!prefs.canEdit} onClick={() => setDraft(DEFAULTS)}>
            Reset to default
          </button>
          <div className="ee-settings-legal ee-settings-legal-inline">
            <a href="#privacy" onClick={(e) => e.preventDefault()}>
              Privacy
            </a>
            <span>|</span>
            <a href="#security" onClick={(e) => e.preventDefault()}>
              Security
            </a>
            <span>|</span>
            <a href="#terms" onClick={(e) => e.preventDefault()}>
              Terms of Service
            </a>
          </div>
          <div className="ee-settings-actions-right">
            <button type="button" className="btn ee-btn-outline-blue" disabled={!draft} onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" disabled={!draft || busy || !prefs.canEdit} onClick={() => void save()}>
              Save changes
            </button>
          </div>
        </footer>
      }
    >
      <div className="ee-settings-reports">
        <div className="ee-settings-reports-opts">
          <div className="ee-settings-info">
            <Info size={16} strokeWidth={1.5} aria-hidden="true" />
            <span>These settings apply to standard and custom reports.</span>
          </div>

          <h3 className="ee-settings-group-label">Visual</h3>
          <ul className="ee-settings-accordion">
            {REPORT_VISUAL.map((item) => (
              <li key={item.id}>
                <button type="button" className="ee-settings-accordion-btn" onClick={() => toggle(item.id)} aria-expanded={open === item.id}>
                  <span>
                    {item.label}
                    {"badge" in item && item.badge ? <span className="ee-settings-new">{item.badge}</span> : null}
                  </span>
                  <ChevronDown size={16} strokeWidth={1.5} className={open === item.id ? "open" : ""} />
                </button>
                {open === item.id && (
                  <div className="ee-settings-accordion-body">
                    <div className="ee-settings-row">
                      <div className="ee-settings-row-label">{item.id === "empty" ? "Show a dash" : "Show"}</div>
                      <SettingsToggle label={item.label} on={Boolean(look[item.id])} disabled={!prefs.canEdit} onChange={(v) => set(item.id, v)} />
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>

          <h3 className="ee-settings-group-label">Formatting</h3>
          <ul className="ee-settings-accordion">
            {REPORT_FORMATTING.map((item) => (
              <li key={item.id}>
                <button type="button" className="ee-settings-accordion-btn" onClick={() => toggle(item.id)} aria-expanded={open === item.id}>
                  <span>{item.label}</span>
                  <ChevronDown size={16} strokeWidth={1.5} className={open === item.id ? "open" : ""} />
                </button>
                {open === item.id && (
                  <div className="ee-settings-accordion-body">
                    <select className="ee-input-select" aria-label={item.label} disabled={!prefs.canEdit} value={String(look[item.id])} onChange={(e) => set(item.id, e.target.value)}>
                      {CHOICES[item.id].map((o) => <option key={o}>{o}</option>)}
                    </select>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>

        <aside className="ee-settings-preview" aria-label="Sample report">
          <div className="ee-settings-preview-frame">
            <div className="ee-settings-preview-page">
              <div className="ee-settings-preview-mark" aria-hidden="true">
                SAMPLE REPORT
              </div>
              {look.header ? (
                <>
                  <h4>{company.name} — Profit and Loss</h4>
                  <p className="muted small">January – December 2026 · Amounts in {company.currency}</p>
                </>
              ) : null}
              <table className={`ee-settings-preview-table ${look.banded ? "banded" : ""} ${look.grid ? "" : "no-grid"} ${look.column ? "col-hi" : ""} ${look.view === "Compact" ? "compact" : ""}`}>
                <thead>
                  <tr>
                    <th>Account</th>
                    <th className="num">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {SAMPLE_PNL_ROWS.map((row) => (
                    <tr key={row.label} className={row.highlight ? "highlight" : ""}>
                      <td style={{ paddingLeft: 12 + (row.indent ?? 0) * 14 }} className={row.bold ? "strong" : ""}>
                        {row.label}
                      </td>
                      <td className={`num ${row.bold ? "strong" : ""}`}>{figure(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {look.footer ? (
                <div className="ee-settings-preview-foot">
                  <span>Excel Edge ERP · Sample financial report</span>
                  <span>Page 1</span>
                </div>
              ) : null}
            </div>
          </div>
        </aside>
      </div>
    </SettingsLayout>
  );
}
