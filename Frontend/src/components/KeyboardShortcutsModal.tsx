import { Printer, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { COMPANY_ID, KEYBOARD_SHORTCUTS } from "../lib/users-dummy";

const TABS = ["All", "General", "Bank transactions", "Transaction forms", "Lists", "Reports"] as const;

export function KeyboardShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("All");
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return KEYBOARD_SHORTCUTS.filter((r) => !s || r.action.toLowerCase().includes(s));
  }, [q]);

  if (!open) return null;

  async function copyId() {
    try {
      await navigator.clipboard.writeText(COMPANY_ID.replace(/\s/g, ""));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="ee-shortcuts-backdrop" role="presentation" onClick={onClose}>
      <div
        className="ee-shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Company ID and keyboard shortcuts"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ee-shortcuts-head">
          <h2>Company ID and keyboard shortcuts</h2>
          <button type="button" className="ee-icon-btn" aria-label="Close" onClick={onClose}>
            <X size={18} strokeWidth={1.5} />
          </button>
        </header>

        <section className="ee-shortcuts-id">
          <div>
            <div className="ee-shortcuts-label">Company ID</div>
            <div className="ee-shortcuts-id-value">{COMPANY_ID}</div>
          </div>
          <button type="button" className="btn ee-btn-outline-blue btn-sm" onClick={() => void copyId()}>
            {copied ? "Copied" : "Copy"}
          </button>
        </section>

        <section className="ee-shortcuts-body">
          <div className="ee-shortcuts-toolbar">
            <label className="ee-manage-search">
              <Search size={16} strokeWidth={1.5} aria-hidden="true" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search shortcuts" aria-label="Search shortcuts" />
            </label>
            <button type="button" className="ee-icon-btn" aria-label="Print">
              <Printer size={16} strokeWidth={1.5} />
            </button>
          </div>

          <nav className="ee-manage-tabs" aria-label="Shortcut categories">
            {TABS.map((t) => (
              <button key={t} type="button" className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
                {t}
              </button>
            ))}
          </nav>

          <table className="ee-shortcuts-table">
            <thead>
              <tr>
                <th>Action</th>
                <th>Shortcut</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.action}>
                  <td>{r.action}</td>
                  <td>
                    <span className="ee-shortcuts-keys">
                      {r.keys.map((k) => (
                        <kbd key={k}>{k}</kbd>
                      ))}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <footer className="ee-shortcuts-foot">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            OK
          </button>
        </footer>
      </div>
    </div>
  );
}
