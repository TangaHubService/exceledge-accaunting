import {
  BarChart3,
  BookOpen,
  ChevronDown,
  FolderKanban,
  LayoutGrid,
  type LucideIcon,
  Megaphone,
  PanelLeftClose,
  PanelLeftOpen,
  PieChart,
  Receipt,
  Settings2,
  Users,
  UsersRound,
  Warehouse,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  defaultOpenHubs,
  hubForApp,
  isAppActive,
  resolveActiveLeaf,
} from "../../lib/app-hub-nav";
import { ALL_APPS } from "../../lib/dashboard-dummy";
import { Link, navigate, useLocation } from "../../lib/router";

const SW = 1.5;
const COLLAPSE_KEY = "ee.allApps.sidebarCollapsed";

const APP_ICONS: Record<string, LucideIcon> = {
  accounting: BookOpen,
  expenses: Receipt,
  sales: BarChart3,
  customers: Users,
  team: UsersRound,
  projects: FolderKanban,
  inventory: Warehouse,
  tax: PieChart,
  marketing: Megaphone,
};

/** Docked All apps nav matching the Customer Hub / Team / CoA mocks. */
export function AllAppsSidebar({ activeLeaf }: { activeLeaf?: string } = {}) {
  const { path } = useLocation();
  const leaf = resolveActiveLeaf(path, activeLeaf);
  const [open, setOpen] = useState<Record<string, boolean>>(() => defaultOpenHubs(path));
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const next = defaultOpenHubs(path);
    setOpen((prev) => {
      const key = Object.keys(next)[0];
      if (!key || prev[key]) return prev;
      return { ...prev, [key]: true };
    });
  }, [path]);

  useEffect(() => {
    const el = document.querySelector<HTMLElement>(".ee-apps-dock-link.on");
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [path, leaf]);

  function toggle(key: string) {
    setOpen((s) => ({ ...s, [key]: !s[key] }));
  }

  function toggleCollapsed() {
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
      <aside className="ee-apps-dock collapsed" aria-label="All apps">
        <button type="button" className="ee-apps-dock-toggle" onClick={toggleCollapsed} aria-label="Show All apps menu" title="Show menu">
          <PanelLeftOpen size={18} strokeWidth={SW} aria-hidden="true" />
        </button>
      </aside>
    );
  }

  return (
    <aside className="ee-apps-dock" aria-label="All apps">
      <div className="ee-apps-dock-head">
        <span>All apps</span>
        <button type="button" className="ee-apps-dock-toggle" onClick={toggleCollapsed} aria-label="Hide All apps menu" title="Hide menu">
          <PanelLeftClose size={17} strokeWidth={SW} aria-hidden="true" />
        </button>
      </div>
      <nav className="ee-apps-dock-nav">
        {ALL_APPS.map((app) => {
          const Icon = APP_ICONS[app.key] ?? APP_ICONS[app.icon] ?? LayoutGrid;
          const hub = hubForApp(app.key);
          const canExpand = Boolean(hub?.items.length);
          const expanded = Boolean(open[app.key]);
          const activeApp = isAppActive(app.key, path);

          return (
            <div key={app.key} className={`ee-apps-dock-group ${activeApp ? "is-current" : ""}`}>
              <button
                type="button"
                className={`ee-apps-dock-item ${activeApp ? "active-app" : ""}`}
                onClick={() => {
                  if (canExpand) toggle(app.key);
                  else if (app.to) navigate(app.to);
                }}
                aria-expanded={canExpand ? expanded : undefined}
              >
                <span className="ee-apps-icon" style={{ background: app.color }}>
                  <Icon size={14} strokeWidth={1.75} color="#fff" />
                </span>
                <span className="ee-apps-label">{app.label}</span>
                {canExpand ? (
                  <ChevronDown
                    size={14}
                    strokeWidth={SW}
                    className={`ee-apps-dock-chevron ${expanded ? "open" : ""}`}
                    aria-hidden="true"
                  />
                ) : null}
              </button>

              {canExpand && expanded && hub ? (
                <ul className="ee-apps-dock-sub">
                  {hub.items.map((item) => (
                    <li key={item.id}>
                      <Link
                        to={item.to}
                        className={`ee-apps-dock-link ${leaf === item.id ? "on" : ""}`}
                        aria-current={leaf === item.id ? "page" : undefined}
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          );
        })}
      </nav>
      <div className="ee-apps-dock-foot">
        <button type="button" className="ee-apps-dock-customise" onClick={() => navigate("/")}>
          <Settings2 size={14} strokeWidth={SW} aria-hidden="true" />
          Customise
        </button>
      </div>
    </aside>
  );
}
