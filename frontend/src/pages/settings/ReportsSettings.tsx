import { ChevronDown, Info } from "lucide-react";
import { useState } from "react";
import { SettingsLayout } from "../../components/settings/SettingsLayout";
import { REPORT_FORMATTING, REPORT_VISUAL, SAMPLE_PNL_ROWS } from "../../lib/settings-dummy";

export function ReportsSettings() {
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
          <button type="button" className="btn ee-btn-outline-blue">
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
            <button type="button" className="btn ee-btn-outline-blue">
              Cancel
            </button>
            <button type="button" className="btn btn-primary">
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
                    <p className="muted small">Options for {item.label.toLowerCase()} appear here.</p>
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
                    <p className="muted small">Options for {item.label.toLowerCase()} appear here.</p>
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
              <h4>EXCEL EDGE CPA — Profit and Loss</h4>
              <p className="muted small">January – December 2026 · Amounts in RWF</p>
              <table className="ee-settings-preview-table">
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
                      <td className={`num ${row.bold ? "strong" : ""}`}>{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="ee-settings-preview-foot">
                <span>Excel Edge ERP · Sample financial report</span>
                <span>Page 1</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </SettingsLayout>
  );
}
