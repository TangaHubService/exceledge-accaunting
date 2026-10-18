import {
  BarChart3,
  Bell,
  Bookmark,
  BookOpen,
  Briefcase,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FolderKanban,
  Grid3X3,
  HelpCircle,
  Home,
  LayoutGrid,
  LogOut,
  type LucideIcon,
  Menu as MenuIcon,
  MoreHorizontal,
  Pencil,
  PieChart,
  Plus,
  Receipt,
  Search,
  Settings,
  SlidersHorizontal,
  Truck,
  Users,
  UserRound,
  Wallet,
  Warehouse,
  WifiOff,
  X,
  Zap,
} from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ALL_APPS, CREATE_MENU, DUMMY, PINNED, REPORTS_MENU } from "../lib/dashboard-dummy";
import { useCompany } from "../lib/company";
import { erpLinks } from "../lib/config";
import { humanize } from "../lib/format";
import { Link, navigate, useLocation } from "../lib/router";
import { useSession } from "../lib/session";
import { AllAppsSidebar } from "./customers/AllAppsSidebar";
import { CustomisePreferences } from "./CustomisePreferences";
import { SearchWorkspace } from "./SearchWorkspace";
import { Menu } from "./ui";

/** Thin stroke matching the mock line icons. */
const SW = 1.5;

type Panel = "create" | "bookmarks" | "reports" | "apps" | string | null;

type PanelPos = { top: number; left: number; maxHeight: number };

const CREATE_ICONS: Record<string, LucideIcon> = {
  customers: UserRound,
  suppliers: Truck,
  team: Users,
  projects: FolderKanban,
  other: MoreHorizontal,
};

const PIN_ICONS: Record<string, LucideIcon> = {
  accounting: BookOpen,
  expenses: Wallet,
  sales: BarChart3,
};

const APP_ICONS: Record<string, LucideIcon> = {
  accounting: BookOpen,
  expenses: Receipt,
  sales: BarChart3,
  customers: Users,
  team: Users,
  projects: FolderKanban,
  inventory: Warehouse,
  tax: PieChart,
};

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

/** Place panel beside the rail trigger, fully on-screen (never clipped by sidebar scroll). */
function placeBeside(el: HTMLElement | null, opts?: { caretAlign?: boolean }): PanelPos | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const pad = 12;
  const left = Math.round(r.right + (opts?.caretAlign ? 10 : 8));
  // Bookmarks mock: caret points at the active rail row center.
  let top = opts?.caretAlign ? Math.round(r.top + r.height / 2 - 22) : Math.round(r.top);
  top = Math.max(pad, Math.min(top, window.innerHeight - pad - 120));
  const maxHeight = Math.max(160, window.innerHeight - top - pad);
  return { top, left, maxHeight };
}

export function Shell({ children }: { children: ReactNode }) {
  const { email, role, signOut } = useSession();
  const company = useCompany();
  const { path } = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const [customiseOpen, setCustomiseOpen] = useState(false);
  const [customiseTab, setCustomiseTab] = useState<"navigation" | "bookmarks">("navigation");
  const [searchOpen, setSearchOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<Array<{ label: string; to: string }>>([]);
  const createBtnRef = useRef<HTMLButtonElement>(null);
  const bookmarksBtnRef = useRef<HTMLButtonElement>(null);
  const reportsBtnRef = useRef<HTMLButtonElement>(null);
  const appsBtnRef = useRef<HTMLButtonElement>(null);
  const pinBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const closeTimer = useRef<number | null>(null);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine);
  const companyLabel = company.name || DUMMY.companyName;
  const customerHub = path.startsWith("/customers");

  function clearCloseTimer() {
    if (closeTimer.current != null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }

  function scheduleClose() {
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => setPanel(null), 160);
  }

  function openPanel(next: Panel) {
    clearCloseTimer();
    setPanel((cur) => (cur === next ? null : next));
  }

  function showPin(key: string) {
    clearCloseTimer();
    setPanel(key);
  }

  useEffect(() => {
    setNavOpen(false);
    setPanel(null);
    setSearchOpen(false);
  }, [path]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
        setPanel(null);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useLayoutEffect(() => {
    if (!panel) {
      setPanelPos(null);
      return;
    }
    const anchor =
      panel === "create"
        ? createBtnRef.current
        : panel === "bookmarks"
          ? bookmarksBtnRef.current
          : panel === "reports"
            ? reportsBtnRef.current
            : panel === "apps"
              ? appsBtnRef.current
              : pinBtnRefs.current[panel] ?? null;

    function update() {
      setPanelPos(placeBeside(anchor, { caretAlign: panel === "bookmarks" }));
    }
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [panel]);

  useEffect(() => {
    if (!panel) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPanel(null);
    }
    function onClick(e: MouseEvent) {
      const t = e.target as HTMLElement | null;
      if (t?.closest(".ee-rail, .ee-panel-fixed")) return;
      setPanel(null);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [panel]);

  function go(to?: string) {
    clearCloseTimer();
    setPanel(null);
    setNavOpen(false);
    if (to) navigate(to);
  }

  function bookmarkCurrent() {
    const label =
      path === "/"
        ? "Home"
        : path
            .split("/")
            .filter(Boolean)
            .map((p) => p.replace(/-/g, " "))
            .map((p) => p[0]!.toUpperCase() + p.slice(1))
            .join(" · ") || "Home";
    setBookmarks((prev) => (prev.some((b) => b.to === path) ? prev : [...prev, { label, to: path }]));
  }

  const panelStyle: CSSProperties | undefined = panelPos
    ? {
        top: panelPos.top,
        left: panelPos.left,
        maxHeight: panelPos.maxHeight,
      }
    : undefined;

  return (
    <div className={`ee-app ${navOpen ? "nav-open" : ""} ${customerHub ? "ee-hub-open" : ""}`}>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <aside className="ee-rail" aria-label="Accounting navigation">
        <div className="ee-rail-brand">
          <span className="ee-rail-logo" aria-hidden="true">
            <LayoutGrid size={18} strokeWidth={SW} />
          </span>
          <div className="ee-rail-brand-text">
            <div className="ee-rail-name">Excel Edge ERP</div>
            <div className="ee-rail-sub">Accounting</div>
          </div>
          <button type="button" className="ee-icon-btn ee-rail-close" onClick={() => setNavOpen(false)} aria-label="Close menu">
            <X size={18} strokeWidth={SW} />
          </button>
        </div>

        <div className="ee-rail-create-wrap">
          <button
            ref={createBtnRef}
            type="button"
            className={`ee-create-btn ${panel === "create" ? "open" : ""}`}
            onClick={() => openPanel("create")}
            aria-expanded={panel === "create"}
            aria-haspopup="dialog"
          >
            <Plus size={18} strokeWidth={2.25} />
            <span>Create</span>
          </button>
        </div>

        <nav className="ee-rail-nav" aria-label="Main">
          <button
            ref={bookmarksBtnRef}
            type="button"
            className={`ee-rail-item ${panel === "bookmarks" ? "active" : ""}`}
            title="Bookmarks"
            aria-expanded={panel === "bookmarks"}
            onClick={() => openPanel("bookmarks")}
          >
            <Bookmark size={18} strokeWidth={SW} fill={panel === "bookmarks" ? "currentColor" : "none"} />
            <span>Bookmarks</span>
          </button>

          <Link to="/" className={`ee-rail-item ${path === "/" && panel !== "bookmarks" ? "active" : ""}`} onClick={() => setNavOpen(false)}>
            <Home size={18} strokeWidth={SW} />
            <span>Home</span>
          </Link>

          <button
            ref={reportsBtnRef}
            type="button"
            className={`ee-rail-item ${panel === "reports" ? "hot" : ""} ${path.startsWith("/reports") && panel !== "bookmarks" ? "active" : ""}`}
            aria-expanded={panel === "reports"}
            onClick={() => openPanel("reports")}
          >
            <BarChart3 size={18} strokeWidth={SW} />
            <span>Reports</span>
          </button>

          <button
            ref={appsBtnRef}
            type="button"
            className={`ee-rail-item ${panel === "apps" || customerHub ? "hot" : ""} ${customerHub ? "active" : ""}`}
            aria-expanded={panel === "apps" || customerHub}
            onClick={() => {
              if (customerHub) {
                setPanel(null);
                navigate("/customers");
                return;
              }
              openPanel("apps");
            }}
          >
            <Grid3X3 size={18} strokeWidth={SW} />
            <span>All apps</span>
          </button>

          <div className="ee-rail-section">Pinned</div>
          {PINNED.map((pin) => {
            const Icon = PIN_ICONS[pin.key] ?? BookOpen;
            const open = panel === pin.key;
            return (
              <button
                key={pin.key}
                ref={(el) => {
                  pinBtnRefs.current[pin.key] = el;
                }}
                type="button"
                className={`ee-rail-item ${open ? "hot" : ""}`}
                aria-expanded={open}
                onMouseEnter={() => showPin(pin.key)}
                onMouseLeave={scheduleClose}
                onClick={() => showPin(pin.key)}
              >
                <Icon size={18} strokeWidth={SW} />
                <span>{pin.label}</span>
                <ChevronRight size={14} strokeWidth={SW} className="ee-rail-chevron" />
              </button>
            );
          })}
        </nav>

        <div className="ee-rail-foot">
          <Link to="/setup" className="ee-rail-item" onClick={() => setNavOpen(false)}>
            <Settings size={18} strokeWidth={SW} />
            <span>Settings</span>
          </Link>
          <button
            type="button"
            className={`ee-rail-item ${customiseOpen ? "active" : ""}`}
            onClick={() => {
              setPanel(null);
              setCustomiseTab("navigation");
              setCustomiseOpen(true);
            }}
          >
            <SlidersHorizontal size={18} strokeWidth={SW} />
            <span>Customise</span>
          </button>
        </div>
      </aside>

      {/* Fixed panels — outside overflow so they match the mock and stay fully visible */}
      {panel === "create" && panelStyle && (
        <div className="ee-create-menu ee-panel-fixed" style={panelStyle} role="dialog" aria-label="Create new">
          <div className="ee-create-title">Create new</div>
          <div className="ee-create-grid">
            {CREATE_MENU.map((col) => {
              const Icon = CREATE_ICONS[col.icon] ?? MoreHorizontal;
              return (
                <div className="ee-create-col" key={col.title}>
                  <div className="ee-create-col-head">
                    <Icon size={16} strokeWidth={SW} />
                    <span>{col.title}</span>
                  </div>
                  <ul>
                    {col.items.map((item) => (
                      <li key={item.label}>
                        <button type="button" className="ee-create-link" onClick={() => go(item.to)} disabled={!item.to}>
                          {item.label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {panel === "bookmarks" && panelStyle && (
        <div className="ee-bookmarks ee-panel-fixed" style={panelStyle} role="dialog" aria-label="Bookmarks">
          <span className="ee-bookmarks-caret" aria-hidden="true" />
          <div className="ee-bookmarks-head">
            <strong>Bookmarks</strong>
            <button
              type="button"
              className="ee-bookmarks-edit"
              aria-label="Edit bookmarks"
              title="Edit"
              onClick={() => {
                setPanel(null);
                setCustomiseTab("bookmarks");
                setCustomiseOpen(true);
              }}
            >
              <Pencil size={15} strokeWidth={SW} />
            </button>
          </div>
          {bookmarks.length === 0 ? (
            <p className="ee-bookmarks-empty">Add a bookmark to get started.</p>
          ) : (
            <ul className="ee-bookmarks-list">
              {bookmarks.map((b) => (
                <li key={b.to}>
                  <button type="button" className="ee-bookmarks-link" onClick={() => go(b.to)}>
                    {b.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" className="ee-bookmarks-add" onClick={bookmarkCurrent}>
            <Plus size={15} strokeWidth={2.25} />
            Bookmark current page
          </button>
        </div>
      )}

      {panel === "reports" && panelStyle && (
        <div className="ee-flyout ee-flyout-list ee-panel-fixed" style={panelStyle} role="menu" aria-label="Reports">
          {REPORTS_MENU.map((item) => (
            <button
              type="button"
              key={item.label}
              className="ee-flyout-text"
              onClick={() => ("to" in item && item.to ? go(item.to) : undefined)}
              disabled={!("to" in item && item.to)}
            >
              <span>{item.label}</span>
              {"hasChildren" in item && item.hasChildren ? <ChevronRight size={14} strokeWidth={SW} /> : null}
            </button>
          ))}
        </div>
      )}

      {panel === "apps" && panelStyle && (
        <div className="ee-apps ee-panel-fixed" style={panelStyle} role="menu" aria-label="All apps">
          <div className="ee-apps-title">All apps</div>
          {ALL_APPS.map((app) => {
            const Icon = APP_ICONS[app.icon] ?? LayoutGrid;
            return (
              <button type="button" key={app.key} className="ee-apps-item" onClick={() => go(app.to)}>
                <span className="ee-apps-icon" style={{ background: app.color }}>
                  <Icon size={15} strokeWidth={1.75} color="#fff" />
                </span>
                <span className="ee-apps-label">{app.label}</span>
                <ChevronRight size={14} strokeWidth={SW} className="ee-apps-chevron" />
              </button>
            );
          })}
        </div>
      )}

      {PINNED.map((pin) => {
        if (panel !== pin.key || !panelStyle) return null;
        return (
          <div
            key={pin.key}
            className="ee-flyout ee-flyout-list ee-panel-fixed"
            style={panelStyle}
            role="menu"
            aria-label={pin.label}
            onMouseEnter={clearCloseTimer}
            onMouseLeave={scheduleClose}
          >
            <div className="ee-flyout-title">{pin.flyoutTitle}</div>
            {pin.items.map((item) => (
              <button type="button" key={item.to + item.label} className="ee-flyout-text" onClick={() => go(item.to)}>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        );
      })}

      <CustomisePreferences
        open={customiseOpen}
        initialTab={customiseTab}
        onClose={() => setCustomiseOpen(false)}
        onSaveBookmarks={(pages) => setBookmarks(pages)}
      />

      <SearchWorkspace open={searchOpen} onClose={() => setSearchOpen(false)} />

      <div className="ee-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />

      {customerHub && <AllAppsSidebar activeLeaf="customers-leads" />}

      <div className="ee-main">
        <header className="ee-topbar">
          <div className="ee-topbar-left">
            <button type="button" className="ee-icon-btn ee-menu-btn" onClick={() => setNavOpen((v) => !v)} aria-label="Open menu" aria-expanded={navOpen}>
              <MenuIcon size={20} strokeWidth={SW} />
            </button>
            <button type="button" className="ee-org-btn" title={companyLabel}>
              <span>{companyLabel}</span>
              <ChevronDown size={15} strokeWidth={SW} />
            </button>
          </div>

          <button
            type="button"
            className="ee-search"
            onClick={() => {
              setPanel(null);
              setSearchOpen(true);
            }}
          >
            <Search size={16} strokeWidth={SW} aria-hidden="true" />
            <span className="ee-search-placeholder">Search transactions, contacts, reports...</span>
          </button>

          <div className="ee-topbar-actions">
            {!online && (
              <span className="ee-offline" role="status">
                <WifiOff size={14} strokeWidth={SW} /> Offline
              </span>
            )}
            <button type="button" className="ee-icon-btn ee-hide-sm" title="Tasks" aria-label="Tasks">
              <CheckSquare size={20} strokeWidth={SW} />
            </button>
            <button type="button" className="ee-icon-btn ee-hide-sm" title="Quick actions" aria-label="Quick actions">
              <Zap size={20} strokeWidth={SW} />
            </button>
            <button type="button" className="ee-icon-btn ee-hide-sm" title="Apps" aria-label="Apps">
              <Grid3X3 size={20} strokeWidth={SW} />
            </button>
            <button type="button" className="ee-icon-btn ee-hide-sm" title="Organisation" aria-label="Organisation">
              <Briefcase size={20} strokeWidth={SW} />
            </button>
            <button type="button" className="ee-icon-btn" title="Help" aria-label="Help">
              <HelpCircle size={20} strokeWidth={SW} />
            </button>
            <Link to="/notifications" className="ee-icon-btn ee-bell" aria-label={`Notifications, ${DUMMY.notificationCount} unread`}>
              <Bell size={20} strokeWidth={SW} />
              <span className="ee-badge">{DUMMY.notificationCount}</span>
            </Link>
            <Link to="/setup" className="ee-icon-btn" aria-label="Settings">
              <Settings size={20} strokeWidth={SW} />
            </Link>
            <Menu
              triggerClassName="ee-user-btn"
              ariaLabel="Account"
              label={
                <span className="ee-avatar" aria-hidden="true">
                  {initials(email)}
                </span>
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
          </div>
        </header>

        <main className="ee-content" id="main-content" tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}
