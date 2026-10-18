import {
  BarChart3,
  BookOpen,
  ChevronDown,
  FolderKanban,
  LayoutGrid,
  type LucideIcon,
  PieChart,
  Receipt,
  SlidersHorizontal,
  Users,
  Warehouse,
} from "lucide-react";
import { useState } from "react";
import { ALL_APPS } from "../../lib/dashboard-dummy";
import { CUSTOMER_HUB_ITEMS } from "../../lib/customer-hub-dummy";
import { Link, useLocation } from "../../lib/router";

const SW = 1.5;

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

const EXPANDABLE = new Set(["customers", "accounting", "expenses", "sales", "team", "projects"]);

/** Docked All apps nav matching the Customer Hub mock (secondary sidebar). */
export function AllAppsSidebar({ activeLeaf = "customers-leads" }: { activeLeaf?: string }) {
  const { path } = useLocation();
  const [open, setOpen] = useState<Record<string, boolean>>({ customers: true });

  function toggle(key: string) {
    setOpen((s) => ({ ...s, [key]: !s[key] }));
  }

  return (
    <aside className="ee-apps-dock" aria-label="All apps">
      <div className="ee-apps-dock-head">
        <span>All apps</span>
        <SlidersHorizontal size={14} strokeWidth={SW} aria-hidden="true" />
      </div>
      <nav className="ee-apps-dock-nav">
        {ALL_APPS.map((app) => {
          const Icon = APP_ICONS[app.icon] ?? LayoutGrid;
          const expanded = Boolean(open[app.key]);
          const canExpand = EXPANDABLE.has(app.key);
          const isCustomers = app.key === "customers";

          return (
            <div key={app.key} className="ee-apps-dock-group">
              <button
                type="button"
                className={`ee-apps-dock-item ${isCustomers && path.startsWith("/customers") ? "active-app" : ""}`}
                onClick={() => (canExpand ? toggle(app.key) : undefined)}
                aria-expanded={canExpand ? expanded : undefined}
              >
                <span className="ee-apps-icon" style={{ background: app.color }}>
                  <Icon size={14} strokeWidth={1.75} color="#fff" />
                </span>
                <span className="ee-apps-label">{app.label}</span>
                {canExpand && (
                  <ChevronDown
                    size={14}
                    strokeWidth={SW}
                    className={`ee-apps-dock-chevron ${expanded ? "open" : ""}`}
                    aria-hidden="true"
                  />
                )}
              </button>

              {isCustomers && expanded && (
                <ul className="ee-apps-dock-sub">
                  {CUSTOMER_HUB_ITEMS.map((item) => (
                    <li key={item.id}>
                      <Link
                        to={item.to}
                        className={`ee-apps-dock-link ${activeLeaf === item.id ? "on" : ""}`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
