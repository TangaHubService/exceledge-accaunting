import { ArrowLeft, BookOpen, FileText, Home, Landmark, PieChart } from "lucide-react";
import { Link, useLocation } from "../lib/router";

const QUICK_LINKS = [
  { to: "/accounting/chart-of-accounts", label: "Chart of accounts", icon: BookOpen },
  { to: "/invoices", label: "Invoices", icon: FileText },
  { to: "/banking", label: "Banking", icon: Landmark },
  { to: "/reports", label: "Reports", icon: PieChart },
];

/** Shown for any path that no route matches. */
export function NotFound() {
  const { path } = useLocation();
  const canGoBack = typeof window !== "undefined" && window.history.length > 1;

  return (
    <section className="nf" aria-labelledby="nf-title">
      <div className="nf-card">
        <LedgerArt />
        <p className="nf-code">Error 404</p>
        <h1 id="nf-title" className="nf-title">
          This page isn't in the books
        </h1>
        <p className="nf-body">
          We couldn't find <code className="nf-path">{path}</code>. The link may be out of date, or the page may have moved.
        </p>
        <div className="nf-actions">
          <Link to="/" className="btn btn-primary">
            <Home size={15} aria-hidden /> Go to overview
          </Link>
          {canGoBack && (
            <button type="button" className="btn" onClick={() => window.history.back()}>
              <ArrowLeft size={15} aria-hidden /> Go back
            </button>
          )}
        </div>
        <div className="nf-links">
          <p className="nf-links-label">Or jump to</p>
          <ul>
            {QUICK_LINKS.map(({ to, label, icon: Icon }) => (
              <li key={to}>
                <Link to={to} className="nf-link">
                  <Icon size={16} aria-hidden />
                  {label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** A ledger page with one row that doesn't balance — the missing entry. */
function LedgerArt() {
  return (
    <svg className="nf-art" viewBox="0 0 220 140" role="img" aria-label="" aria-hidden>
      <rect x="30" y="10" width="160" height="120" rx="8" className="nf-art-sheet" />
      <line x1="30" y1="34" x2="190" y2="34" className="nf-art-rule-strong" />
      <line x1="122" y1="10" x2="122" y2="130" className="nf-art-rule" />
      <line x1="156" y1="10" x2="156" y2="130" className="nf-art-rule" />
      <rect x="42" y="19" width="40" height="7" rx="3.5" className="nf-art-head" />
      <rect x="130" y="19" width="18" height="7" rx="3.5" className="nf-art-head" />
      <rect x="164" y="19" width="18" height="7" rx="3.5" className="nf-art-head" />
      {[48, 68, 108].map((y) => (
        <g key={y}>
          <rect x="42" y={y - 4} width="62" height="7" rx="3.5" className="nf-art-cell" />
          <rect x="132" y={y - 4} width="16" height="7" rx="3.5" className="nf-art-cell" />
          <rect x="166" y={y - 4} width="16" height="7" rx="3.5" className="nf-art-cell" />
        </g>
      ))}
      <rect x="36" y="78" width="148" height="20" rx="4" className="nf-art-gap" />
      <text x="110" y="92" textAnchor="middle" className="nf-art-q">
        ? ? ?
      </text>
      <circle cx="184" cy="20" r="14" className="nf-art-badge" />
      <text x="184" y="25" textAnchor="middle" className="nf-art-badge-text">
        !
      </text>
    </svg>
  );
}
