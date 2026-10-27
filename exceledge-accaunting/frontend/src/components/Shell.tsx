import {
  BarChart3,
  Bell,
  Bookmark,
  BookOpen,
  Briefcase,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  FolderKanban,
  Grid3X3,
  HelpCircle,
  Home,
  LayoutGrid,
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
import { APP_HUBS, isAppActive } from "../lib/app-hub-nav";
import { ALL_APPS, CREATE_MENU, CUSTOMISE_NAV_APPS, DUMMY, REPORTS_MENU } from "../lib/dashboard-dummy";
import { APP_FLYOUTS } from "../lib/settings-dummy";
import { useCompany } from "../lib/company";
import { isPathActive, Link, navigate, useLocation } from "../lib/router";
import { useSession } from "../lib/session";
import { AllAppsSidebar } from "./customers/AllAppsSidebar";
import { CustomisePreferences } from "./CustomisePreferences";
import { KeyboardShortcutsModal } from "./KeyboardShortcutsModal";
import { HelpDrawer } from "./ribbon/HelpDrawer";
import { InboxDrawer } from "./ribbon/InboxDrawer";
import { IntegrationsModal } from "./ribbon/IntegrationsModal";
import { NotificationsPopover } from "./ribbon/NotificationsPopover";
import { SettingsMegaMenu } from "./ribbon/SettingsMegaMenu";
import { TasksDrawer } from "./ribbon/TasksDrawer";
import { UserProfileMenu } from "./ribbon/UserProfileMenu";
import { SearchWorkspace } from "./SearchWorkspace";

/** Thin stroke matching the mock line icons. */
const SW = 1.5;

type Panel = "create" | "bookmarks" | "reports" | "apps" | string | null;
type Overlay = "tasks" | "help" | "inbox" | "integrations" | "notifications" | "settings" | "profile" | null;

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
  customers: Users,
  team: Users,
  projects: FolderKanban,
  inventory: Warehouse,
  lists: Warehouse,
  tax: PieChart,
};

const DEFAULT_PINNED_KEYS = CUSTOMISE_NAV_APPS.filter((a) => a.pinned).map((a) => a.key);

const APP_ICONS: Record<string, LucideIcon> = {
  accounting: BookOpen,
  expenses: Receipt,
  sales: BarChart3,
  customers: Users,
  team: Users,
  projects: FolderKanban,
  inventory: Warehouse,
  lists: Warehouse,
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
  const { email } = useSession();
  const company = useCompany();
  const { path } = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [panelPos, setPanelPos] = useState<PanelPos | null>(null);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [customiseOpen, setCustomiseOpen] = useState(false);
  const [customiseTab, setCustomiseTab] = useState<"navigation" | "bookmarks">("navigation");
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [bookmarks, setBookmarks] = useState<Array<{ label: string; to: string }>>([]);
  const [pinnedKeys, setPinnedKeys] = useState<string[]>(() => [...DEFAULT_PINNED_KEYS]);
  const [showNavLabels, setShowNavLabels] = useState(true);
  const createBtnRef = useRef<HTMLButtonElement>(null);
  const bookmarksBtnRef = useRef<HTMLButtonElement>(null);
  const reportsBtnRef = useRef<HTMLButtonElement>(null);
  const appsBtnRef = useRef<HTMLButtonElement>(null);
  const notifBtnRef = useRef<HTMLButtonElement>(null);
  const settingsBtnRef = useRef<HTMLButtonElement>(null);
  const profileBtnRef = useRef<HTMLButtonElement>(null);
  const pinBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const closeTimer = useRef<number | null>(null);
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine);
  const companyLabel = company.name || DUMMY.companyName;

  function openOverlay(next: Overlay) {
    setPanel(null);
    setSearchOpen(false);
    setOverlay((cur) => (cur === next ? null : next));
  }

  function closeOverlay() {
    setOverlay(null);
  }

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

  /** Open flyout on hover (same behaviour as Pinned). */
  function showPanel(key: Panel) {
    clearCloseTimer();
    setPanel(key);
  }

  useEffect(() => {
    setNavOpen(false);
    setPanel(null);
    setSearchOpen(false);
    setOverlay(null);
  }, [path]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOverlay(null);
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

  const hubOpen = APP_HUBS.some((hub) => isAppActive(hub.key, path));

  return (
    <div className={`ee-app ${navOpen ? "nav-open" : ""} ${hubOpen ? "ee-hub-open" : ""}`}>
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
            onMouseEnter={() => showPanel("create")}
            onMouseLeave={scheduleClose}
            onClick={() => openPanel("create")}
            aria-expanded={panel === "create"}
            aria-haspopup="dialog"
          >
            <Plus size={18} strokeWidth={2.25} />
            {showNavLabels && <span>Create</span>}
          </button>
        </div>

        <nav className="ee-rail-nav" aria-label="Main">
          <button
            ref={bookmarksBtnRef}
            type="button"
            className={`ee-rail-item ${panel === "bookmarks" ? "active" : ""}`}
            title="Bookmarks"
            aria-expanded={panel === "bookmarks"}
            onMouseEnter={() => showPanel("bookmarks")}
            onMouseLeave={scheduleClose}
            onClick={() => openPanel("bookmarks")}
          >
            <Bookmark size={18} strokeWidth={SW} fill={panel === "bookmarks" ? "currentColor" : "none"} />
            {showNavLabels && <span>Bookmarks</span>}
          </button>

          <Link to="/" className={`ee-rail-item ${path === "/" && panel !== "bookmarks" ? "active" : ""}`} onClick={() => setNavOpen(false)}>
            <Home size={18} strokeWidth={SW} />
            {showNavLabels && <span>Home</span>}
          </Link>

          <button
            ref={reportsBtnRef}
            type="button"
            className={`ee-rail-item ${panel === "reports" ? "hot" : ""} ${path.startsWith("/reports") && panel !== "bookmarks" ? "active" : ""}`}
            aria-expanded={panel === "reports"}
            onMouseEnter={() => showPanel("reports")}
            onMouseLeave={scheduleClose}
            onClick={() => openPanel("reports")}
          >
            <BarChart3 size={18} strokeWidth={SW} />
            {showNavLabels && <span>Reports</span>}
          </button>

          <button
            ref={appsBtnRef}
            type="button"
            className={`ee-rail-item ${panel === "apps" ? "hot" : ""}`}
            aria-expanded={panel === "apps"}
            onMouseEnter={() => showPanel("apps")}
            onMouseLeave={scheduleClose}
            onClick={() => openPanel("apps")}
          >
            <Grid3X3 size={18} strokeWidth={SW} />
            {showNavLabels && <span>All apps</span>}
          </button>

          <div className="ee-rail-section">Pinned</div>
          {pinnedKeys.map((key) => {
            const meta = CUSTOMISE_NAV_APPS.find((a) => a.key === key);
            const Icon = PIN_ICONS[key] ?? BookOpen;
            const open = panel === key;
            const sectionOn = isAppActive(key, path);
            const label = meta?.label ?? key;
            return (
              <button
                key={key}
                ref={(el) => {
                  pinBtnRefs.current[key] = el;
                }}
                type="button"
                className={`ee-rail-item ${open ? "hot" : ""} ${sectionOn && !open ? "active" : ""}`}
                aria-expanded={open}
                aria-current={sectionOn ? "page" : undefined}
                onMouseEnter={() => showPanel(key)}
                onMouseLeave={scheduleClose}
                onClick={() => showPanel(key)}
              >
                <Icon size={18} strokeWidth={SW} />
                {showNavLabels && <span>{label.replace(/ & .*$/, "").replace(" Management", "")}</span>}
                <ChevronRight size={14} strokeWidth={SW} className="ee-rail-chevron" />
              </button>
            );
          })}
        </nav>

        <div className="ee-rail-foot">
          <Link
            to="/settings/company"
            className={`ee-rail-item ${path.startsWith("/settings") || path.startsWith("/users") ? "active" : ""}`}
            onClick={() => setNavOpen(false)}
          >
            <Settings size={18} strokeWidth={SW} />
            {showNavLabels && <span>Settings</span>}
          </Link>
          <button
            type="button"
            className={`ee-rail-item ${customiseOpen ? "active" : ""}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setPanel(null);
              setOverlay(null);
              setCustomiseTab("navigation");
              setCustomiseOpen(true);
            }}
          >
            <SlidersHorizontal size={18} strokeWidth={SW} />
            {showNavLabels && <span>Customise</span>}
          </button>
        </div>
      </aside>

      {/* Fixed panels — outside overflow so they match the mock and stay fully visible */}
      {panel === "create" && panelStyle && (
        <div
          className="ee-create-menu ee-panel-fixed"
          style={panelStyle}
          role="dialog"
          aria-label="Create new"
          onMouseEnter={clearCloseTimer}
          onMouseLeave={scheduleClose}
        >
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
                        <button type="button" className="ee-create-link" onClick={() => go(item.to ?? "/")}>
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
        <div
          className="ee-bookmarks ee-panel-fixed"
          style={panelStyle}
          role="dialog"
          aria-label="Bookmarks"
          onMouseEnter={clearCloseTimer}
          onMouseLeave={scheduleClose}
        >
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
              {bookmarks.map((b) => {
                const on = isPathActive(path, b.to);
                return (
                  <li key={b.to}>
                    <button
                      type="button"
                      className={`ee-bookmarks-link ${on ? "on" : ""}`}
                      aria-current={on ? "page" : undefined}
                      onClick={() => go(b.to)}
                    >
                      {b.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <button type="button" className="ee-bookmarks-add" onClick={bookmarkCurrent}>
            <Plus size={15} strokeWidth={2.25} />
            Bookmark current page
          </button>
        </div>
      )}

      {panel === "reports" && panelStyle && (
        <div
          className="ee-flyout ee-flyout-list ee-panel-fixed"
          style={panelStyle}
          role="menu"
          aria-label="Reports"
          onMouseEnter={clearCloseTimer}
          onMouseLeave={scheduleClose}
        >
          {REPORTS_MENU.map((item) => {
            const to = "to" in item && item.to ? item.to : "/reports/statements";
            const on = isPathActive(path, to);
            return (
              <button
                type="button"
                key={item.label}
                className={`ee-flyout-text ${on ? "on" : ""}`}
                aria-current={on ? "page" : undefined}
                onClick={() => go(to)}
              >
                <span>{item.label}</span>
                {"hasChildren" in item && item.hasChildren ? <ChevronRight size={14} strokeWidth={SW} /> : null}
              </button>
            );
          })}
        </div>
      )}

      {panel === "apps" && panelStyle && (
        <div
          className="ee-apps ee-panel-fixed"
          style={panelStyle}
          role="menu"
          aria-label="All apps"
          onMouseEnter={clearCloseTimer}
          onMouseLeave={scheduleClose}
        >
          <div className="ee-apps-title">All apps</div>
          {ALL_APPS.map((app) => {
            const Icon = APP_ICONS[app.icon] ?? LayoutGrid;
            const on = isAppActive(app.key, path) || isPathActive(path, app.to);
            return (
              <button
                type="button"
                key={app.key}
                className={`ee-apps-item ${on ? "on" : ""}`}
                aria-current={on ? "page" : undefined}
                onClick={() => go(app.to)}
              >
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

      {pinnedKeys.map((key) => {
        if (panel !== key || !panelStyle) return null;
        const flyout = APP_FLYOUTS[key];
        const meta = CUSTOMISE_NAV_APPS.find((a) => a.key === key);
        if (!flyout) return null;
        return (
          <div
            key={key}
            className="ee-flyout ee-flyout-list ee-panel-fixed"
            style={panelStyle}
            role="menu"
            aria-label={meta?.label ?? key}
            onMouseEnter={clearCloseTimer}
            onMouseLeave={scheduleClose}
          >
            <div className="ee-flyout-title">{flyout.flyoutTitle}</div>
            {flyout.items.map((item) => {
              const on = isPathActive(path, item.to);
              return (
                <button
                  type="button"
                  key={item.to + item.label}
                  className={`ee-flyout-text ${on ? "on" : ""}`}
                  aria-current={on ? "page" : undefined}
                  onClick={() => go(item.to)}
                >
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        );
      })}

      <CustomisePreferences
        open={customiseOpen}
        initialTab={customiseTab}
        pinnedKeys={pinnedKeys}
        showLabels={showNavLabels}
        onClose={() => setCustomiseOpen(false)}
        onSaveBookmarks={(pages) => setBookmarks(pages)}
        onSaveNavigation={(keys, labels) => {
          setPinnedKeys(keys);
          setShowNavLabels(labels);
        }}
      />

      <SearchWorkspace open={searchOpen} onClose={() => setSearchOpen(false)} />

      <div className="ee-scrim" onClick={() => setNavOpen(false)} aria-hidden="true" />

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
              setOverlay(null);
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
            <button
              type="button"
              className={`ee-icon-btn ee-hide-sm ${overlay === "tasks" ? "active" : ""}`}
              title="Tasks"
              aria-label="Tasks"
              aria-expanded={overlay === "tasks"}
              onClick={() => openOverlay("tasks")}
            >
              <CheckSquare size={20} strokeWidth={SW} />
            </button>
            <button
              type="button"
              className={`ee-icon-btn ee-hide-sm ${path.startsWith("/workflows") ? "active" : ""}`}
              title="Workflows"
              aria-label="Workflows"
              onClick={() => {
                closeOverlay();
                navigate("/workflows");
              }}
            >
              <Zap size={20} strokeWidth={SW} />
            </button>
            <button
              type="button"
              className={`ee-icon-btn ee-hide-sm ${overlay === "integrations" ? "active" : ""}`}
              title="Integrations"
              aria-label="Integrations"
              aria-expanded={overlay === "integrations"}
              onClick={() => openOverlay("integrations")}
            >
              <Grid3X3 size={20} strokeWidth={SW} />
            </button>
            <button
              type="button"
              className={`ee-icon-btn ee-hide-sm ${overlay === "inbox" ? "active" : ""}`}
              title="Inbox"
              aria-label="Inbox"
              aria-expanded={overlay === "inbox"}
              onClick={() => openOverlay("inbox")}
            >
              <Briefcase size={20} strokeWidth={SW} />
            </button>
            <button
              type="button"
              className={`ee-icon-btn ${overlay === "help" ? "active" : ""}`}
              title="Help"
              aria-label="Help"
              aria-expanded={overlay === "help"}
              onClick={() => openOverlay("help")}
            >
              <HelpCircle size={20} strokeWidth={SW} />
            </button>
            <button
              ref={notifBtnRef}
              type="button"
              className={`ee-icon-btn ee-bell ${overlay === "notifications" ? "active" : ""}`}
              title="Notifications"
              aria-label={`Notifications, ${DUMMY.notificationCount} unread`}
              aria-expanded={overlay === "notifications"}
              onClick={() => openOverlay("notifications")}
            >
              <Bell size={20} strokeWidth={SW} />
              <span className="ee-badge">{DUMMY.notificationCount}</span>
            </button>
            <button
              ref={settingsBtnRef}
              type="button"
              className={`ee-icon-btn ${overlay === "settings" ? "active" : ""}`}
              title="Settings"
              aria-label="Settings"
              aria-expanded={overlay === "settings"}
              onClick={() => openOverlay("settings")}
            >
              <Settings size={20} strokeWidth={SW} />
            </button>
            <button
              ref={profileBtnRef}
              type="button"
              className={`ee-user-btn ${overlay === "profile" ? "active" : ""}`}
              title="Account"
              aria-label="Account"
              aria-expanded={overlay === "profile"}
              onClick={() => openOverlay("profile")}
            >
              <span className="ee-avatar" aria-hidden="true">
                {initials(email)}
              </span>
            </button>
          </div>
        </header>

        <div className={`ee-workspace ${hubOpen ? "has-dock" : ""}`}>
          {hubOpen ? <AllAppsSidebar /> : null}
          <main className="ee-content" id="main-content" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>

      <TasksDrawer open={overlay === "tasks"} onClose={closeOverlay} />
      <HelpDrawer open={overlay === "help"} onClose={closeOverlay} />
      <InboxDrawer open={overlay === "inbox"} onClose={closeOverlay} />
      <IntegrationsModal open={overlay === "integrations"} onClose={closeOverlay} />
      <NotificationsPopover open={overlay === "notifications"} onClose={closeOverlay} anchorRef={notifBtnRef} />
      <SettingsMegaMenu open={overlay === "settings"} onClose={closeOverlay} anchorRef={settingsBtnRef} />
      <UserProfileMenu open={overlay === "profile"} onClose={closeOverlay} anchorRef={profileBtnRef} />

      <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
}
