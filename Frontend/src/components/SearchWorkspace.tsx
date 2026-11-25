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
import { createPortal } from "react-dom";
import { SEARCH_EXPLORE, SEARCH_QUICK } from "../lib/dashboard-dummy";
import { amount } from "../lib/format";
import { navigate } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import { TXN_LABELS, type TxnKind } from "../lib/txn";

const SW = 1.5;
const FILTERS = ["All", "Transactions", "Contacts", "Reports", "Pages", "Help"] as const;

/** The list each kind of transaction is found in. */
const LIST_PATHS: Record<string, string> = {
  invoice: "/invoices", payment: "/invoices", "credit-note": "/invoices", estimate: "/invoices", "sales-order": "/invoices", proposal: "/invoices",
  bill: "/bills", "bill-payment": "/supplier-payments", "supplier-credit": "/suppliers", "purchase-order": "/suppliers", expense: "/expenses/list",
  journal: "/journals", "bank-deposit": "/banking/transactions", cheque: "/banking/transactions", transfer: "/banking/transactions", "item-receipt": "/inventory/movements", "inventory-adjustment": "/inventory/movements", time: "/time/weekly",
};

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

  const { can } = useSession();
  const [term, setTerm] = useState("");
  useEffect(() => {
    const t = window.setTimeout(() => setTerm(query.trim()), 250);
    return () => window.clearTimeout(t);
  }, [query]);
  const found = useResource<{ rows: Array<{ id: string; kind: TxnKind; number: string; party: string; amount: number }> }>(
    open && can("report:view") ? `/api/v1/workspace/transactions?pageSize=8${term ? `&q=${encodeURIComponent(term)}` : ""}` : null,
  );
  const recent = useMemo(() => {
    if (filter !== "All" && filter !== "Transactions") return [];
    return (found.data?.rows ?? []).map((r) => {
      const tag = TXN_LABELS[r.kind] ?? r.kind;
      return { id: r.id, title: `${tag} ${r.number}`.trim(), subtitle: [r.party, amount(r.amount)].filter(Boolean).join(" · "), tag, tone: "invoice" as string, to: LIST_PATHS[r.kind] ?? "/reports/standard" };
    });
  }, [found.data, filter]);

  if (!open) return null;

  function go(to: string) {
    onClose();
    navigate(to);
  }

  return createPortal(
    <div className="ee-modal-root" role="presentation">
      <button type="button" className="ee-modal-backdrop" aria-label="Close search" onClick={onClose} />
      <div
        className="ee-search-ws"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ee-search-ws-title"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
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
            <h3>{term ? "Matching transactions" : "Latest transactions"}</h3>
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
    </div>,
    document.body,
  );
}
