import {
  ArrowRight,
  BarChart3,
  Building2,
  ChevronRight,
  CornerDownLeft,
  FileText,
  HelpCircle,
  LayoutGrid,
  Receipt,
  Search,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SEARCH_EXPLORE, SEARCH_QUICK, SEARCH_RECENT, SEARCH_RECENT_QUERIES } from "../lib/dashboard-dummy";
import { navigate } from "../lib/router";

const SW = 1.5;
const FILTERS = ["All", "Transactions", "Contacts", "Reports", "Pages", "Help"] as const;

type Props = { open: boolean; onClose: () => void };

export function SearchWorkspace({ open, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("All");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setFilter("All");
    const t = window.setTimeout(() => inputRef.current?.focus(), 40);
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const recent = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SEARCH_RECENT;
    return SEARCH_RECENT.filter((r) => r.title.toLowerCase().includes(q) || r.subtitle.toLowerCase().includes(q));
  }, [query]);

  if (!open) return null;

  function go(to: string) {
    onClose();
    navigate(to);
  }

  return (
    <div className="ee-modal-root" role="presentation">
      <button type="button" className="ee-modal-backdrop" aria-label="Close search" onClick={onClose} />
      <div className="ee-search-ws" role="dialog" aria-modal="true" aria-labelledby="ee-search-ws-title">
        <header className="ee-search-ws-head">
          <div className="ee-search-ws-brand">
            <LayoutGrid size={18} strokeWidth={SW} />
            <strong id="ee-search-ws-title">Search workspace</strong>
          </div>
          <div className="ee-search-ws-head-actions">
            <span className="ee-search-ws-esc">Esc to close</span>
            <button type="button" className="ee-customise-close" onClick={onClose} aria-label="Close">
              <X size={18} strokeWidth={SW} />
            </button>
          </div>
        </header>

        <label className="ee-search-ws-input">
          <Search size={18} strokeWidth={SW} aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            placeholder="Find a transaction, contact, report or page..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search workspace"
          />
        </label>

        <div className="ee-search-ws-filters" role="tablist" aria-label="Result types">
          {FILTERS.map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={filter === f}
              className={`ee-search-ws-filter ${filter === f ? "active" : ""}`}
              onClick={() => setFilter(f)}
            >
              {f}
            </button>
          ))}
        </div>

        <div className="ee-search-ws-body">
          <div className="ee-search-ws-main">
            <h3>Recently opened</h3>
            <ul className="ee-search-ws-recent">
              {recent.map((item) => (
                <li key={item.id}>
                  <button type="button" className="ee-search-ws-hit" onClick={() => go(item.to)}>
                    <span className={`ee-search-ws-hit-icon ${item.tone}`}>
                      {item.tone === "invoice" ? (
                        <FileText size={18} strokeWidth={SW} />
                      ) : item.tone === "page" ? (
                        <Building2 size={18} strokeWidth={SW} />
                      ) : (
                        <BarChart3 size={18} strokeWidth={SW} />
                      )}
                    </span>
                    <span className="ee-search-ws-hit-meta">
                      <strong>{item.title}</strong>
                      <small>{item.subtitle}</small>
                    </span>
                    <span className={`ee-search-ws-tag ${item.tone}`}>{item.tag}</span>
                  </button>
                </li>
              ))}
            </ul>

            <h3>Quick actions</h3>
            <div className="ee-search-ws-quick">
              {SEARCH_QUICK.map((a) => (
                <button key={a.label} type="button" className="ee-search-ws-qa" onClick={() => go(a.to)}>
                  {a.icon === "invoice" ? (
                    <FileText size={16} strokeWidth={SW} />
                  ) : a.icon === "expense" ? (
                    <Receipt size={16} strokeWidth={SW} />
                  ) : (
                    <UserPlus size={16} strokeWidth={SW} />
                  )}
                  {a.label}
                </button>
              ))}
            </div>

            <button type="button" className="ee-search-ws-advanced" onClick={() => go("/journals")}>
              Advanced transaction search
              <ArrowRight size={14} strokeWidth={SW} />
            </button>
          </div>

          <aside className="ee-search-ws-side">
            <h3>Explore your workspace</h3>
            <ul className="ee-search-ws-explore">
              {SEARCH_EXPLORE.map((e) => (
                <li key={e.label}>
                  <button type="button" className="ee-search-ws-explore-item" onClick={() => go(e.to)}>
                    <span className="ee-search-ws-explore-icon">
                      {e.label === "Transactions" ? (
                        <FileText size={16} strokeWidth={SW} />
                      ) : e.label === "Contacts" ? (
                        <Users size={16} strokeWidth={SW} />
                      ) : e.label === "Reports" ? (
                        <BarChart3 size={16} strokeWidth={SW} />
                      ) : (
                        <HelpCircle size={16} strokeWidth={SW} />
                      )}
                    </span>
                    <span>
                      <strong>{e.label}</strong>
                      <small>{e.hint}</small>
                    </span>
                    <ChevronRight size={14} strokeWidth={SW} className="muted" />
                  </button>
                </li>
              ))}
            </ul>

            <h3>Recent searches</h3>
            <div className="ee-search-ws-chips">
              {SEARCH_RECENT_QUERIES.map((q) => (
                <button key={q} type="button" className="ee-search-ws-chip" onClick={() => setQuery(q)}>
                  <Search size={13} strokeWidth={SW} />
                  {q}
                </button>
              ))}
            </div>
          </aside>
        </div>

        <footer className="ee-search-ws-foot">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> Navigate
          </span>
          <span>
            <CornerDownLeft size={12} strokeWidth={2} /> Open
          </span>
          <span>
            <kbd>Esc</kbd> Close
          </span>
        </footer>
      </div>
    </div>
  );
}
