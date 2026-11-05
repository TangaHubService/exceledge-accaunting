import { BarChart3, Building2, ChevronDown, ChevronUp, FilePen, FileText, Landmark, ListFilter, MessageSquareText, PanelLeftClose, PanelLeftOpen, Plus, ReceiptText, ScrollText, X } from "lucide-react";
import { type LucideIcon } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ALL_REPORTS, feedback, reportHref } from "../../lib/reports";
import { isPathActive, Link, navigate, setQueryParam, useLocation } from "../../lib/router";
import { useFeedback } from "../feedback";
import { Menu } from "../ui";

/* ── Sidebar ────────────────────────────────────────────── */

const NAV = [
  { label: "Standard reports", to: "/reports/standard" },
  { label: "Custom reports", to: "/reports/custom" },
  { label: "Management reports", to: "/reports/management" },
  { label: "KPIs", to: "/reports/kpis" },
  { label: "Dashboards", to: "/reports/dashboards" },
  { label: "Spreadsheet sync", to: "/reports/spreadsheet-sync" },
  { label: "Performance centre", to: "/reports/performance" },
];
const PLANNING = [
  { label: "Cash flow overview", to: "/reports/cash-flow" },
  { label: "Cash flow planner", to: "/reports/cash-flow-planner" },
  { label: "Budgets", to: "/budgets" },
  { label: "Forecasts", to: "/reports/forecasts" },
];

/** Paths inside the Reports section; forecast editors take the full width. */
export function isReportsPath(path: string) {
  return path === "/budgets" || path === "/reports" || path.startsWith("/reports/");
}
export function showsReportsSidebar(path: string) {
  return isReportsPath(path) && !/^\/reports\/forecasts\/.+/.test(path);
}

function activeNav(path: string) {
  const planning = PLANNING.find((p) => isPathActive(path, p.to));
  if (planning) return planning.to;
  const direct = NAV.find((n) => isPathActive(path, n.to));
  if (direct) return direct.to;
  // Older report pages (statements, ageing, trial balance…) sit under Standard reports.
  return "/reports/standard";
}

const COLLAPSE_KEY = "ee.reports.sidebarCollapsed";

export function ReportsSidebar() {
  const { path } = useLocation();
  const current = activeNav(path);
  const [planningOpen, setPlanningOpen] = useState(true);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });

  function toggle() {
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* the preference just won't stick */
      }
      return !c;
    });
  }

  if (collapsed) {
    return (
      <aside className="rp-dock collapsed no-print" aria-label="Reports and analytics">
        <button type="button" className="rp-dock-toggle" onClick={toggle} aria-label="Expand reports menu" title="Expand menu">
          <PanelLeftOpen size={18} aria-hidden="true" />
        </button>
      </aside>
    );
  }

  const link = (item: { label: string; to: string }, sub = false) => (
    <Link key={item.to} to={item.to} className={`rp-dock-link ${sub ? "sub" : ""} ${current === item.to ? "on" : ""}`} aria-current={current === item.to ? "page" : undefined}>
      {item.label}
    </Link>
  );

  return (
    <aside className="rp-dock no-print" aria-label="Reports and analytics">
      <div className="rp-dock-head">
        <span>Reports &amp; analytics</span>
        <button type="button" className="rp-dock-toggle" onClick={toggle} aria-label="Collapse reports menu" title="Collapse menu">
          <PanelLeftClose size={17} aria-hidden="true" />
        </button>
      </div>
      <nav>
        {NAV.map((n) => link(n))}
        <button type="button" className="rp-dock-link rp-dock-group" onClick={() => setPlanningOpen((o) => !o)} aria-expanded={planningOpen}>
          Financial planning
          {planningOpen ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
        </button>
        {planningOpen && PLANNING.map((n) => link(n, true))}
      </nav>
    </aside>
  );
}

/* ── Modal shell ────────────────────────────────────────── */

export function Modal({ title, onClose, children, footer, width = 760, hideClose }: { title?: ReactNode; onClose: () => void; children: ReactNode; footer?: ReactNode; width?: number; hideClose?: boolean }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);
  return (
    <div className="rp-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rp-modal" style={{ maxWidth: width }} role="dialog" aria-modal="true" ref={panel} tabIndex={-1}>
        {!hideClose && (
          <button type="button" className="rp-modal-close" onClick={onClose} aria-label="Close">
            <X size={22} aria-hidden="true" />
          </button>
        )}
        {title && <h2 className="rp-modal-title">{title}</h2>}
        <div>{children}</div>
        {footer && <div className="rp-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ── Report picker ──────────────────────────────────────── */

export function ReportPicker() {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const matches = useMemo(() => {
    const q = text.trim().toLowerCase();
    return (q ? ALL_REPORTS.filter((r) => r.name.toLowerCase().includes(q)) : ALL_REPORTS).slice(0, 40);
  }, [text]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  return (
    <div className="rp-picker" ref={ref}>
      <input
        placeholder="Type report name here"
        aria-label="Find a report"
        value={text}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setText(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && matches[0]) navigate(reportHref(matches[0]));
          if (e.key === "Escape") setOpen(false);
        }}
      />
      <button type="button" aria-label="Show all reports" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="rp-picker-list" role="listbox">
          {matches.length === 0 ? (
            <p>No report has that name.</p>
          ) : (
            matches.map((r) => (
              <Link key={r.name} to={reportHref(r)} role="option" onClick={() => setOpen(false)}>
                {r.name}
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/* ── Create new report ──────────────────────────────────── */

const REPORT_TYPES: Array<{ id: string; label: string; icon: LucideIcon; slug: string }> = [
  { id: "blank", label: "Blank", icon: Plus, slug: "profit-and-loss-by-month" },
  { id: "invoice", label: "Invoice", icon: FileText, slug: "invoice-list" },
  { id: "expenses", label: "Expenses", icon: ReceiptText, slug: "expense-list" },
  { id: "sales", label: "Sales", icon: BarChart3, slug: "income-by-customer-summary" },
  { id: "bills", label: "Bills", icon: ScrollText, slug: "purchase-list" },
  { id: "journal", label: "Journal Entry", icon: FilePen, slug: "journal-entries" },
  { id: "banking", label: "Banking Transactions", icon: Landmark, slug: "banking-transactions" },
  { id: "transactions", label: "Transactions List", icon: ListFilter, slug: "banking-transactions" },
];

export function ReportTypeModal({ onClose }: { onClose: () => void }) {
  const [picked, setPicked] = useState<string | null>(null);
  const create = () => {
    const type = REPORT_TYPES.find((t) => t.id === picked);
    if (!type) return;
    onClose();
    navigate(`/reports/view/${type.slug}?new=1&type=${encodeURIComponent(type.label)}`);
  };
  return (
    <Modal
      title="Select the report type"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rp-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="rp-btn rp-btn-primary" disabled={!picked} onClick={create}>
            Create
          </button>
        </>
      }
    >
      <div className="rp-type-grid" role="radiogroup" aria-label="Report type">
        {REPORT_TYPES.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={picked === t.id} className={`rp-type ${picked === t.id ? "on" : ""}`} onClick={() => setPicked(t.id)} onDoubleClick={create}>
            <t.icon size={46} strokeWidth={1.5} aria-hidden="true" />
            <span>{t.label}</span>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function CreateReportButton() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rp-split">
      <button type="button" className="rp-btn rp-btn-primary" onClick={() => setOpen(true)}>
        Create new report
      </button>
      <Menu
        label={null}
        ariaLabel="More ways to create a report"
        triggerClassName="rp-btn rp-btn-primary rp-split-caret"
        items={[
          { label: "Custom report", icon: Plus, onSelect: () => setOpen(true) },
          { label: "Management report", icon: Building2, onSelect: () => navigate("/reports/management?new=1") },
          { label: "KPI", icon: BarChart3, onSelect: () => navigate("/reports/kpis?new=1") },
        ]}
      />
      {open && <ReportTypeModal onClose={() => setOpen(false)} />}
    </div>
  );
}

export function AskQuestion({ children = "Ask a question", beta }: { children?: ReactNode; beta?: boolean }) {
  return (
    <button type="button" className={beta ? "rp-btn" : "rp-link rp-ask"} onClick={() => setQueryParam("assistant", "1")}>
      {children}
      {beta && <span className="rp-beta">BETA</span>}
    </button>
  );
}

/* ── Give feedback ──────────────────────────────────────── */

export function GiveFeedback() {
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  return (
    <>
      <button type="button" className="rp-link rp-feedback" onClick={() => setOpen(true)}>
        <MessageSquareText size={19} aria-hidden="true" /> Give feedback
      </button>
      {open && (
        <Modal
          title="Give feedback"
          width={520}
          onClose={() => setOpen(false)}
          footer={
            <>
              <button type="button" className="rp-btn" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="rp-btn rp-btn-primary"
                onClick={() => {
                  if (!text.trim()) return setError("Tell us what you think before sending.");
                  feedback(text.trim());
                  setText("");
                  setError("");
                  setOpen(false);
                  toast("Thanks. Your feedback is saved on this device.");
                }}
              >
                Save
              </button>
            </>
          }
        >
          <label className="rp-field">
            <span>What would make this page better?</span>
            <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} aria-invalid={Boolean(error)} />
            {error && <small className="rp-error">{error}</small>}
          </label>
        </Modal>
      )}
    </>
  );
}

/* ── Planning hero ──────────────────────────────────────── */

export function PlanningHero({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rp-hero">
      <div className="rp-hero-copy">
        <h2>{title}</h2>
        {children}
      </div>
      <img src="/illustrations/planning-hero.png" alt="" className="rp-hero-art" />
    </section>
  );
}

export function PageTitle({ title, actions }: { title: string; actions?: ReactNode }) {
  return (
    <div className="rp-title-row">
      <h1>{title}</h1>
      {actions && <div className="rp-actions no-print">{actions}</div>}
    </div>
  );
}

export function RpSelect<T extends string>({ value, onChange, options, label, className = "" }: { value: T; onChange: (v: T) => void; options: ReadonlyArray<{ key: T; label: string }>; label: string; className?: string }) {
  return (
    <select className={`rp-select ${className}`} aria-label={label} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
