import { ChevronDown, Info, Plus } from "lucide-react";
import { useState } from "react";
import { Link, navigate } from "../lib/router";
import { FORM_STYLES } from "../lib/users-dummy";

const NEW_STYLE_TYPES = ["Invoice", "Estimate", "Sales receipt", "Sales order"] as const;

export function CustomFormStyles() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="ee-manage">
      <header className="ee-manage-head ee-manage-head-row">
        <div>
          <h1>Custom form styles</h1>
          <p>Create consistent, professional forms for your business.</p>
          <Link to="/" className="ee-link-btn ee-manage-back">
            ← Back to all lists
          </Link>
        </div>
        <div className="ee-manage-split-primary">
          <button type="button" className="btn btn-primary" onClick={() => navigate("/settings/form-styles/edit")}>
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" /> New style
          </button>
          <button
            type="button"
            className="btn btn-primary ee-manage-split-caret"
            aria-expanded={menuOpen}
            aria-label="New style type"
            onClick={() => setMenuOpen((o) => !o)}
          >
            <ChevronDown size={16} strokeWidth={1.75} />
          </button>
          {menuOpen && (
            <ul className="ee-manage-select-menu ee-manage-new-style-menu" role="menu">
              {NEW_STYLE_TYPES.map((t) => (
                <li key={t}>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      navigate(`/settings/form-styles/edit?type=${encodeURIComponent(t)}`);
                    }}
                  >
                    {t}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      <div className="ee-settings-info">
        <Info size={16} strokeWidth={1.75} aria-hidden="true" />
        <div>
          <strong>Choose the right template for your invoices and estimates</strong>
          <div>Manage your saved styles below. Use the action menu to edit a style or set your preferred template as default.</div>
        </div>
      </div>

      <div className="ee-manage-card">
        <table className="ee-manage-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Form type</th>
              <th>Last edited</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {FORM_STYLES.map((s) => (
              <tr key={s.id}>
                <td>
                  <button type="button" className="ee-link-btn" style={{ padding: 0 }} onClick={() => navigate("/settings/form-styles/edit")}>
                    {s.name}
                  </button>
                  {s.isDefault ? <span className="ee-settings-pill" style={{ marginLeft: 8 }}>Default</span> : null}
                </td>
                <td>{s.formType}</td>
                <td>{s.lastEdited}</td>
                <td>
                  <span className="ee-manage-action-split">
                    <button type="button" className="btn ee-btn-outline-blue btn-sm" onClick={() => navigate("/settings/form-styles/edit")}>
                      Edit
                    </button>
                    <button type="button" className="btn ee-btn-outline-blue btn-sm ee-manage-split-caret" aria-label="More">
                      <ChevronDown size={14} strokeWidth={1.75} />
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ee-manage-count">{FORM_STYLES.length} styles</div>
      </div>
    </div>
  );
}
