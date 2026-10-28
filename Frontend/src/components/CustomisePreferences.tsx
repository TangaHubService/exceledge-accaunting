import {
  BookOpen,
  FolderKanban,
  GripVertical,
  PieChart,
  Receipt,
  Search,
  Users,
  Warehouse,
  X,
  BarChart3,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CUSTOMISE_BOOKMARK_PAGES, CUSTOMISE_NAV_APPS } from "../lib/dashboard-dummy";

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

type Tab = "navigation" | "bookmarks";

type Props = {
  open: boolean;
  initialTab?: Tab;
  pinnedKeys?: string[];
  showLabels?: boolean;
  onClose: () => void;
  onSaveBookmarks?: (pages: Array<{ label: string; to: string }>) => void;
  onSaveNavigation?: (pinnedKeys: string[], showLabels: boolean) => void;
};

type NavApp = { key: string; label: string; color: string; icon: string; pinned: boolean };

export function CustomisePreferences({
  open,
  initialTab = "navigation",
  pinnedKeys,
  showLabels: showLabelsProp = true,
  onClose,
  onSaveBookmarks,
  onSaveNavigation,
}: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [showLabels, setShowLabels] = useState(showLabelsProp);
  const [navApps, setNavApps] = useState<NavApp[]>(() =>
    CUSTOMISE_NAV_APPS.map((a) => ({
      ...a,
      pinned: pinnedKeys ? pinnedKeys.includes(a.key) : a.pinned,
    })),
  );
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setQuery("");
    setShowLabels(showLabelsProp);
    setNavApps(
      CUSTOMISE_NAV_APPS.map((a) => ({
        ...a,
        pinned: pinnedKeys ? pinnedKeys.includes(a.key) : a.pinned,
      })),
    );
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, initialTab, onClose, pinnedKeys, showLabelsProp]);

  const filteredPages = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return CUSTOMISE_BOOKMARK_PAGES;
    return CUSTOMISE_BOOKMARK_PAGES.filter((p) => p.label.toLowerCase().includes(q));
  }, [query]);

  if (!open) return null;

  function toggleNav(key: string) {
    setNavApps((prev) => prev.map((a) => (a.key === key ? { ...a, pinned: !a.pinned } : a)));
  }

  function toggleBookmark(id: string) {
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function saveAndClose() {
    const pages = CUSTOMISE_BOOKMARK_PAGES.filter((p) => selected[p.id]).map((p) => ({
      label: p.label,
      to: p.to,
    }));
    onSaveBookmarks?.(pages);
    onSaveNavigation?.(
      navApps.filter((a) => a.pinned).map((a) => a.key),
      showLabels,
    );
    onClose();
  }

  return createPortal(
    <div className="ee-modal-root" role="presentation">
      <button type="button" className="ee-modal-backdrop" aria-label="Close" onClick={onClose} />
      <div
        className="ee-customise"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ee-customise-title"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ee-customise-head">
          <h2 id="ee-customise-title">Customise preferences</h2>
          <button type="button" className="ee-customise-close" onClick={onClose} aria-label="Close">
            <X size={20} strokeWidth={SW} />
          </button>
        </header>

        <div className="ee-customise-body">
          <nav className="ee-customise-nav" aria-label="Preference sections">
            <button
              type="button"
              className={`ee-customise-tab ${tab === "navigation" ? "active" : ""}`}
              onClick={() => setTab("navigation")}
            >
              Navigation
            </button>
            <button
              type="button"
              className={`ee-customise-tab ${tab === "bookmarks" ? "active" : ""}`}
              onClick={() => setTab("bookmarks")}
            >
              Bookmarks
            </button>
          </nav>

          <div className="ee-customise-main">
            {tab === "navigation" ? (
              <>
                <section className="ee-customise-block">
                  <div className="ee-customise-toggle-row">
                    <div>
                      <h3>Left navigation labels</h3>
                      <p className="ee-customise-hint">
                        Turning off labels in your left navigation makes room to see more of your apps.
                      </p>
                    </div>
                    <button
                      type="button"
                      className={`ee-switch ${showLabels ? "on" : ""}`}
                      role="switch"
                      aria-checked={showLabels}
                      aria-label="Left navigation labels"
                      onClick={() => setShowLabels((v) => !v)}
                    >
                      <span className="ee-switch-knob" />
                    </button>
                  </div>
                </section>

                <section className="ee-customise-block">
                  <h3>Left navigation apps</h3>
                  <p className="ee-customise-hint">Choose which apps appear in your left navigation.</p>
                  <ul className="ee-customise-list">
                    {navApps.map((app) => {
                      const Icon = APP_ICONS[app.icon] ?? BookOpen;
                      return (
                        <li key={app.key}>
                          <div className="ee-customise-row">
                            <span className="ee-customise-grip" aria-hidden="true">
                              <GripVertical size={16} strokeWidth={SW} />
                            </span>
                            <label className="ee-customise-check">
                              <input type="checkbox" checked={app.pinned} onChange={() => toggleNav(app.key)} />
                              <span className="ee-customise-box" />
                            </label>
                            <span className="ee-customise-app-icon" style={{ background: app.color }}>
                              <Icon size={14} strokeWidth={1.75} color="#fff" />
                            </span>
                            <span className="ee-customise-row-label">{app.label}</span>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              </>
            ) : (
              <>
                <label className="ee-customise-search">
                  <Search size={16} strokeWidth={SW} aria-hidden="true" />
                  <input
                    type="search"
                    placeholder="Search pages to bookmark"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search pages to bookmark"
                  />
                </label>
                <p className="ee-customise-hint ee-customise-hint-spaced">
                  Select pages to bookmark, and drag and reorder them to fit the way you work:
                </p>
                <ul className="ee-customise-list ee-customise-list-scroll">
                  {filteredPages.map((page) => (
                    <li key={page.id}>
                      <div className="ee-customise-row">
                        <span className="ee-customise-grip" aria-hidden="true">
                          <GripVertical size={16} strokeWidth={SW} />
                        </span>
                        <label className="ee-customise-check">
                          <input
                            type="checkbox"
                            checked={!!selected[page.id]}
                            onChange={() => toggleBookmark(page.id)}
                          />
                          <span className="ee-customise-box" />
                        </label>
                        <span className="ee-customise-row-label">{page.label}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        </div>

        <footer className="ee-customise-foot">
          <button type="button" className="ee-customise-save" onClick={saveAndClose}>
            Save and close
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
