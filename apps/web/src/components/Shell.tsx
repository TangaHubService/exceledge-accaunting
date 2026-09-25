import type { AccountingCapability } from "@exceledge/accounting-domain";
import {
  ArrowLeftRight,
  ArrowRightLeft,
  Banknote,
  BarChart3,
  BookOpen,
  Boxes,
  Building2,
  Calculator,
  CalendarClock,
  Coins,
  ExternalLink,
  FileText,
  GitCompareArrows,
  HandCoins,
  History,
  Hourglass,
  Landmark,
  LayoutDashboard,
  Library,
  ListChecks,
  ListTree,
  LogOut,
  type LucideIcon,
  Menu as MenuIcon,
  Package,
  PackageSearch,
  PanelLeftClose,
  PanelLeftOpen,
  Percent,
  ReceiptText,
  Scale,
  TriangleAlert,
  Truck,
  Users,
  Wallet,
  Warehouse,
  WifiOff,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useState, useSyncExternalStore } from "react";
import { useCompany } from "../lib/company";
import { erpLinks } from "../lib/config";
import { humanize } from "../lib/format";
import { Link, useLocation } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { PostingException } from "../lib/types";
import { Menu } from "./ui";

type NavItem = { to: string; label: string; icon: LucideIcon; needs: AccountingCapability; count?: number };

const COLLAPSED_KEY = "accounting_nav_collapsed";

function subscribeOnline(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

function initials(email: string | undefined) {
  const local = (email ?? "").split("@")[0];
  const parts = local.split(/[._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function Shell({ children }: { children: ReactNode }) {
  const { can, email, role, signOut } = useSession();
  const company = useCompany();
  const { path } = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSED_KEY) === "1");
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine);

  const openExceptions = useResource<PostingException[]>(can("exceptions:view") ? "/api/v1/exceptions?status=OPEN" : null);

  useEffect(() => setNavOpen(false), [path]);

  useEffect(() => {
    if (!navOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setNavOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navOpen]);

  function toggleCollapsed() {
    localStorage.setItem(COLLAPSED_KEY, collapsed ? "0" : "1");
    setCollapsed(!collapsed);
  }

  const groups: Array<{ label: string; items: NavItem[] }> = [
    { label: "", items: [{ to: "/", label: "Overview", icon: LayoutDashboard, needs: "setup:view" }] },
    {
      label: "Sales",
      items: [
        { to: "/customers", label: "Customers", icon: Users, needs: "ar:view" },
        { to: "/invoices", label: "Invoices", icon: FileText, needs: "ar:view" },
      ],
    },
    {
      label: "Purchases",
      items: [
        { to: "/suppliers", label: "Suppliers", icon: Truck, needs: "ap:view" },
        { to: "/bills", label: "Bills", icon: ReceiptText, needs: "ap:view" },
        { to: "/supplier-payments", label: "Supplier payments", icon: Banknote, needs: "ap:view" },
      ],
    },
    {
      label: "Inventory",
      items: [
        { to: "/inventory", label: "Stock value", icon: Package, needs: "inventory:view" },
        { to: "/inventory/movements", label: "Stock movements", icon: ArrowLeftRight, needs: "inventory:view" },
        { to: "/inventory/reconciliation", label: "Reconciliation", icon: GitCompareArrows, needs: "inventory:view" },
      ],
    },
    {
      label: "Banking",
      items: [
        { to: "/banking", label: "Bank & cash", icon: Landmark, needs: "bank:view" },
        { to: "/banking/transactions", label: "Bank transactions", icon: ArrowRightLeft, needs: "bank:view" },
        { to: "/banking/reconciliation", label: "Bank reconciliation", icon: ListChecks, needs: "bank:view" },
      ],
    },
    {
      label: "Tax",
      items: [
        { to: "/tax", label: "Tax overview", icon: Percent, needs: "tax:view" },
        { to: "/tax/vat", label: "VAT return", icon: ReceiptText, needs: "tax:view" },
        { to: "/tax/filings", label: "Filings", icon: FileText, needs: "tax:view" },
        { to: "/tax/payments", label: "Tax payments", icon: Coins, needs: "tax:view" },
      ],
    },
    {
      label: "Expenses",
      items: [
        { to: "/expenses", label: "Expenses", icon: HandCoins, needs: "expense:view" },
        { to: "/expenses/list", label: "Expense list", icon: ListChecks, needs: "expense:view" },
        { to: "/expenses/recurring", label: "Recurring", icon: CalendarClock, needs: "expense:view" },
      ],
    },
    {
      label: "Fixed assets",
      items: [
        { to: "/fixed-assets", label: "Fixed assets", icon: Warehouse, needs: "fa:view" },
        { to: "/fixed-assets/register", label: "Asset register", icon: ListChecks, needs: "fa:view" },
        { to: "/fixed-assets/depreciation", label: "Depreciation", icon: Calculator, needs: "fa:view" },
      ],
    },
    {
      label: "Accounting",
      items: [
        { to: "/journals", label: "Journal entries", icon: BookOpen, needs: "journal:view" },
        { to: "/ledger", label: "General ledger", icon: Library, needs: "gl:view" },
        { to: "/accounts", label: "Chart of accounts", icon: ListTree, needs: "coa:view" },
      ],
    },
    {
      label: "Reports",
      items: [
        { to: "/reports/trial-balance", label: "Trial balance", icon: Scale, needs: "coa:view" },
        { to: "/reports/ageing", label: "Receivables ageing", icon: Hourglass, needs: "ar:view" },
        { to: "/reports/payables-ageing", label: "Payables ageing", icon: CalendarClock, needs: "ap:view" },
        { to: "/reports/purchases-by-supplier", label: "Purchases by supplier", icon: BarChart3, needs: "ap:view" },
        { to: "/reports/withholding-tax", label: "Withholding tax", icon: Percent, needs: "ap:view" },
        { to: "/reports/inventory-valuation", label: "Inventory valuation", icon: Boxes, needs: "inventory:view" },
        { to: "/reports/cost-of-sales", label: "Cost of goods sold", icon: Coins, needs: "inventory:view" },
        { to: "/reports/slow-moving", label: "Slow-moving stock", icon: PackageSearch, needs: "inventory:view" },
        { to: "/reports/cash-position", label: "Cash position", icon: Wallet, needs: "bank:view" },
      ],
    },
    {
      label: "Administration",
      items: [
        { to: "/setup", label: "Company setup", icon: Building2, needs: "setup:view" },
        { to: "/exceptions", label: "Posting exceptions", icon: TriangleAlert, needs: "exceptions:view", count: openExceptions.data?.length },
        { to: "/audit", label: "Audit log", icon: History, needs: "audit:view" },
      ],
    },
  ];

  const matches = (to: string) => (to === "/" ? path === "/" : path === to || path.startsWith(`${to}/`));
  const activeTo = groups
    .flatMap((g) => g.items.map((i) => i.to))
    .filter(matches)
    .sort((a, b) => b.length - a.length)[0];
  function isActive(to: string) {
    return to === activeTo;
  }

  const dash = company.dashboard;

  return (
    <div className={`app ${navOpen ? "nav-open" : ""} ${collapsed ? "collapsed" : ""}`}>
      <aside className="sidebar" aria-label="Sidebar">
        <div className="sidebar-brand">
          <img src="/logo.jpeg" alt="" />
          <div className="brand-text">
            <div className="name">{company.name}</div>
            <div className="product">Excel Edge Accounting</div>
          </div>
          <button type="button" className="icon-button sidebar-close" onClick={() => setNavOpen(false)} aria-label="Close menu">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <nav aria-label="Main">
          {groups.map((g) => {
            const items = g.items.filter((i) => can(i.needs));
            if (!items.length) return null;
            return (
              <div className="nav-group" key={g.label || "top"}>
                {g.label && <div className="nav-group-label">{g.label}</div>}
                {items.map((i) => (
                  <Link
                    key={i.to}
                    to={i.to}
                    className={`nav-link ${isActive(i.to) ? "active" : ""}`}
                    aria-current={isActive(i.to) ? "page" : undefined}
                    data-tip={i.count ? `${i.label} (${i.count})` : i.label}
                  >
                    <i.icon size={17} strokeWidth={1.75} aria-hidden="true" className="nav-icon" />
                    <span className="nav-label">{i.label}</span>
                    {i.count ? (
                      <span className="nav-count" aria-label={`${i.count} open`}>
                        {i.count}
                      </span>
                    ) : null}
                  </Link>
                ))}
              </div>
            );
          })}
        </nav>
        <div className="sidebar-foot">
          <button
            type="button"
            className="nav-link collapse-toggle"
            onClick={toggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            data-tip="Expand sidebar"
          >
            {collapsed ? (
              <PanelLeftOpen size={17} strokeWidth={1.75} aria-hidden="true" className="nav-icon" />
            ) : (
              <PanelLeftClose size={17} strokeWidth={1.75} aria-hidden="true" className="nav-icon" />
            )}
            <span className="nav-label">Collapse</span>
          </button>
        </div>
      </aside>
      <div className="scrim" onClick={() => setNavOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-button menu-button" onClick={() => setNavOpen(true)} aria-label="Open menu">
            <MenuIcon size={20} aria-hidden="true" />
          </button>
          <div className="context">
            {dash?.currentFinancialYear ? (
              <>
                <strong>{dash.currentFinancialYear.name}</strong>
                {dash.currentOpenPeriod && <> · Open period <strong>{dash.currentOpenPeriod.name}</strong></>}
                {" · "}Amounts in {company.currency}
              </>
            ) : (
              dash && "No financial year set up"
            )}
          </div>
          <div className="spacer" />
          {!online && (
            <span className="badge warning" role="status">
              <WifiOff size={13} aria-hidden="true" />
              Offline
            </span>
          )}
          <a href={erpLinks.home} className="topbar-link hide-sm">
            Excel Edge
            <ExternalLink size={13} aria-hidden="true" />
          </a>
          <Menu
            triggerClassName="user-button"
            ariaLabel="Account"
            label={
              <>
                <span className="avatar" aria-hidden="true">
                  {initials(email)}
                </span>
                <span className="user-name hide-sm">{email ?? "Signed in"}</span>
              </>
            }
            header={
              <>
                <div className="strong">{email ?? "Signed in"}</div>
                {role && <div className="muted small">{humanize(role)}</div>}
              </>
            }
            items={[
              { label: "Back to Excel Edge", icon: ExternalLink, onSelect: () => window.location.assign(erpLinks.home) },
              { label: "Sign out", icon: LogOut, onSelect: signOut },
            ]}
          />
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
