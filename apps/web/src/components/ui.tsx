import { ArrowLeft, ChevronDown, type LucideIcon, X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { daysBetween } from "../lib/format";
import { Link } from "../lib/router";

export type Tone = "positive" | "negative" | "warning" | "info" | "neutral";

export function PageHeader({
  title,
  description,
  back,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  back?: { to: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {back && (
          <Link to={back.to} className="back">
            <ArrowLeft size={14} aria-hidden="true" />
            {back.label}
          </Link>
        )}
        <h1>{title}</h1>
        {description && <p className="description">{description}</p>}
      </div>
      {actions && <div className="actions no-print">{actions}</div>}
    </header>
  );
}

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`badge ${tone === "neutral" ? "" : tone}`}>{children}</span>;
}

/** Where an invoice stands against its due date. */
export function DueStatus({ dueDate, outstanding }: { dueDate: string; outstanding: number }) {
  if (outstanding <= 0.005) return <Badge tone="positive">Paid</Badge>;
  const late = daysBetween(dueDate);
  if (late > 0) return <span className="due-status text-negative strong">{late === 1 ? "1 day" : `${late} days`} overdue</span>;
  if (late === 0) return <span className="due-status text-warning strong">Due today</span>;
  return <span className="due-status muted">Due in {-late === 1 ? "1 day" : `${-late} days`}</span>;
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state-error" role="alert">
      <h3>This couldn't be loaded</h3>
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="btn" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function SkeletonRows({ rows = 6, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="table-wrap" aria-busy="true" aria-label="Loading">
      <table className="table">
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }, (_, c) => (
                <td key={c}>
                  <span className="skeleton" style={{ width: c === 0 ? "60%" : `${30 + ((r + c) % 3) * 15}%` }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Shows skeleton, error or content for a `useResource` result. */
export function Loadable<T>({
  resource,
  skeleton,
  children,
}: {
  resource: { data?: T; error?: string; loading: boolean; reload: () => void };
  skeleton?: ReactNode;
  children: (data: T) => ReactNode;
}) {
  if (resource.data !== undefined) return <>{children(resource.data)}</>;
  if (resource.error) {
    return (
      <div className="panel">
        <ErrorState message={resource.error} onRetry={resource.reload} />
      </div>
    );
  }
  return <>{skeleton ?? <SkeletonRows />}</>;
}

export function Field({
  label,
  required,
  hint,
  error,
  className,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`field ${className ?? ""}`}>
      <span className="field-label">
        {label}
        {required && <span className="req" aria-hidden="true">*</span>}
      </span>
      {children}
      {error ? <span className="field-error">{error}</span> : hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

export function Drawer({
  title,
  subtitle,
  onClose,
  footer,
  wide,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  footer?: ReactNode;
  wide?: boolean;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>("input, select, textarea");
    (first ?? panel.current)?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [onClose]);

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className={`drawer ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={panel} tabIndex={-1}>
        <div className="drawer-head">
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close" title="Close (Esc)">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer && <div className="drawer-foot">{footer}</div>}
      </div>
    </>
  );
}

type MenuItem = { label: string; icon?: LucideIcon; onSelect: () => void };

/** Overflow menu for secondary actions. */
export function Menu({
  label,
  items,
  header,
  triggerClassName = "btn",
  ariaLabel,
}: {
  label: ReactNode;
  items: Array<MenuItem | false | undefined>;
  header?: ReactNode;
  triggerClassName?: string;
  ariaLabel?: string;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const visible = items.filter(Boolean) as MenuItem[];

  useEffect(() => {
    function close() {
      if (ref.current) ref.current.open = false;
    }
    function onDown(e: MouseEvent) {
      if (ref.current?.open && !ref.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && ref.current?.open) {
        close();
        ref.current.querySelector("summary")?.focus();
      }
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  if (!visible.length) return null;
  return (
    <details className="menu" ref={ref}>
      <summary className={triggerClassName} aria-label={ariaLabel}>
        {label}
        <ChevronDown size={14} aria-hidden="true" className="chevron" />
      </summary>
      <div className="menu-list" role="menu">
        {header && <div className="menu-header">{header}</div>}
        {visible.map((i) => (
          <button
            key={i.label}
            type="button"
            role="menuitem"
            onClick={() => {
              if (ref.current) ref.current.open = false;
              i.onSelect();
            }}
          >
            {i.icon && <i.icon size={15} aria-hidden="true" />}
            {i.label}
          </button>
        ))}
      </div>
    </details>
  );
}

/** A labelled figure used in the summary strips at the top of pages. */
export function Figure({
  label,
  value,
  currency,
  note,
  tone,
  lead,
}: {
  label: string;
  value: ReactNode;
  currency?: string;
  note?: ReactNode;
  tone?: Tone;
  lead?: boolean;
}) {
  const toneClass = tone === "negative" ? "text-negative" : tone === "positive" ? "text-positive" : tone === "warning" ? "text-warning" : "";
  return (
    <div className={`figure ${lead ? "lead" : ""}`}>
      <div className="figure-label">{label}</div>
      <div className={`figure-value ${toneClass}`}>
        {currency && <span className="ccy">{currency}</span>}
        {value}
      </div>
      {note && <div className="figure-note">{note}</div>}
    </div>
  );
}
