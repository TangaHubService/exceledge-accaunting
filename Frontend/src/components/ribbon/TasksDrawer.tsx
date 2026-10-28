import { Check, ClipboardCheck, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const SW = 1.5;

type Tab = "open" | "today";

type Props = { open: boolean; onClose: () => void };

export function TasksDrawer({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("open");

  useEffect(() => {
    if (!open) return;
    setTab("open");
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="ee-ribbon-drawer-root" role="presentation">
      <button type="button" className="ee-ribbon-drawer-scrim" aria-label="Close tasks" onClick={onClose} />
      <aside className="ee-ribbon-drawer ee-tasks-drawer" role="dialog" aria-modal="true" aria-labelledby="ee-tasks-title">
        <header className="ee-tasks-head">
          <div className="ee-tasks-title-row">
            <ClipboardCheck size={20} strokeWidth={SW} className="ee-tasks-title-icon" aria-hidden="true" />
            <h2 id="ee-tasks-title">Needs attention</h2>
          </div>
          <button type="button" className="ee-customise-close" onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={SW} />
          </button>
        </header>

        <div className="ee-tasks-tabs" role="tablist" aria-label="Task filters">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "open"}
            className={`ee-tasks-tab ${tab === "open" ? "active" : ""}`}
            onClick={() => setTab("open")}
          >
            Open
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "today"}
            className={`ee-tasks-tab ${tab === "today" ? "active" : ""}`}
            onClick={() => setTab("today")}
          >
            Today
          </button>
        </div>

        <div className="ee-tasks-body">
          <div className="ee-tasks-empty">
            <span className="ee-tasks-empty-icon" aria-hidden="true">
              <Check size={36} strokeWidth={2.5} color="#fff" />
            </span>
            <h3>You&apos;re caught up!</h3>
            <p>No open tasks. Add a task to keep your work on track.</p>
            <p className="ee-tasks-empty-hint">Your tasks and reminders will appear here.</p>
          </div>
        </div>

        <footer className="ee-tasks-foot">
          <button type="button" className="ee-btn-outline ee-tasks-view-all">
            View all
          </button>
          <button type="button" className="ee-btn-primary ee-tasks-add">
            <Plus size={16} strokeWidth={2.25} />
            Add task
          </button>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
