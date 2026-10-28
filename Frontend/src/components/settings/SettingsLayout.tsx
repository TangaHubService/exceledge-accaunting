import {
  ArrowLeft,
  Building2,
  Clock,
  CreditCard,
  FileText,
  Hash,
  HelpCircle,
  Inbox,
  type LucideIcon,
  MessageSquarePlus,
  Settings2,
  Tag,
  Wallet,
  BarChart3,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { SETTINGS_NAV } from "../../lib/settings-dummy";
import { Link, navigate, useLocation } from "../../lib/router";

const SW = 1.5;

const ICONS: Record<string, LucideIcon> = {
  company: Building2,
  usage: BarChart3,
  reports: FileText,
  sales: Tag,
  expenses: CreditCard,
  time: Clock,
  inbox: Inbox,
  wallet: Wallet,
  advanced: Settings2,
  "custom-fields": Hash,
};

/**
 * Settings chrome matches the mocks: brand header + fixed left nav.
 * Only the main pane scrolls — the sidebar stays put.
 */
export function SettingsLayout({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const { path } = useLocation();

  return (
    <div className="ee-settings">
      <header className="ee-settings-top">
        <div className="ee-settings-brand">
          <img src="/logo.jpeg" alt="" width={28} height={28} />
          <span>Excel Edge ERP</span>
        </div>
        <div className="ee-settings-top-bar">
          <div className="ee-settings-top-actions">
            <button type="button" className="ee-settings-top-link">
              <MessageSquarePlus size={16} strokeWidth={SW} />
              Give feedback
            </button>
            <button type="button" className="ee-icon-btn" aria-label="Help" title="Help">
              <HelpCircle size={20} strokeWidth={SW} />
            </button>
            <button
              type="button"
              className="ee-icon-btn"
              aria-label="Close settings"
              title="Close"
              onClick={() => navigate("/")}
            >
              <X size={18} strokeWidth={SW} />
            </button>
          </div>
        </div>
      </header>

      <div className="ee-settings-body">
        <aside className="ee-settings-rail" aria-label="Settings">
          <div className="ee-settings-rail-title">Settings</div>
          <nav className="ee-settings-rail-nav">
            {SETTINGS_NAV.map((item) => {
              const Icon = ICONS[item.id] ?? Settings2;
              const on = path === item.to || path.startsWith(`${item.to}/`);
              return (
                <Link key={item.id} to={item.to} className={`ee-settings-rail-item ${on ? "active" : ""}`}>
                  <Icon size={18} strokeWidth={SW} />
                  <span>{item.label}</span>
                </Link>
              );
            })}
          </nav>
        </aside>

        <div className="ee-settings-main">
          <div className="ee-settings-scroll">
            <div className="ee-settings-page-head">
              <div>
                <h1>{title}</h1>
                {subtitle && <p>{subtitle}</p>}
              </div>
              <button type="button" className="btn ee-btn-outline-blue" onClick={() => navigate("/")}>
                <ArrowLeft size={16} strokeWidth={SW} aria-hidden="true" />
                Back to Home
              </button>
            </div>

            <div className="ee-settings-content">{children}</div>

            {footer ?? (
              <footer className="ee-settings-legal">
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
              </footer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
