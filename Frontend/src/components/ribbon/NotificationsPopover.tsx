import { Bell, CheckCheck, Filter, Settings, X } from "lucide-react";
import { type CSSProperties, type RefObject, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { navigate } from "../../lib/router";

const SW = 1.5;

type Tab = "inbox" | "recommended";

type Props = {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
};

export function NotificationsPopover({ open, onClose, anchorRef }: Props) {
  const [tab, setTab] = useState<Tab>("inbox");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setTab("inbox");
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onClick(e: MouseEvent) {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, onClose, anchorRef]);

  if (!open) return null;

  const anchor = anchorRef.current?.getBoundingClientRect();
  const style: CSSProperties = anchor
    ? {
        top: Math.round(anchor.bottom + 8),
        right: Math.max(12, Math.round(window.innerWidth - anchor.right)),
      }
    : { top: 56, right: 72 };

  return createPortal(
    <div
      ref={panelRef}
      className="ee-notif-popover"
      style={style}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ee-notif-title"
    >
      <header className="ee-notif-head">
        <div className="ee-notif-title-row">
          <Bell size={18} strokeWidth={SW} className="ee-notif-title-icon" aria-hidden="true" />
          <h2 id="ee-notif-title">Notifications</h2>
        </div>
        <button type="button" className="ee-customise-close" onClick={onClose} aria-label="Close">
          <X size={18} strokeWidth={SW} />
        </button>
      </header>

      <div className="ee-notif-tabs" role="tablist" aria-label="Notification types">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "inbox"}
          className={`ee-notif-tab ${tab === "inbox" ? "active" : ""}`}
          onClick={() => setTab("inbox")}
        >
          Inbox
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "recommended"}
          className={`ee-notif-tab ${tab === "recommended" ? "active" : ""}`}
          onClick={() => setTab("recommended")}
        >
          Recommended
        </button>
      </div>

      <div className="ee-notif-actions">
        <button type="button" className="ee-notif-action">
          <CheckCheck size={15} strokeWidth={SW} />
          Mark all as read
        </button>
        <button type="button" className="ee-notif-action">
          <Filter size={15} strokeWidth={SW} />
          Filter
        </button>
      </div>

      <div className="ee-notif-body">
        <div className="ee-notif-empty">
          <span className="ee-notif-empty-icon" aria-hidden="true">
            <Bell size={28} strokeWidth={1.75} />
            <span className="ee-notif-empty-check">
              <CheckCheck size={12} strokeWidth={2.5} color="#fff" />
            </span>
          </span>
          <h3>You&apos;re all caught up</h3>
          <p>New alerts and updates will appear here. Check Recommended for helpful suggestions.</p>
        </div>
      </div>

      <footer className="ee-notif-foot">
        <button
          type="button"
          className="ee-notif-prefs"
          onClick={() => {
            onClose();
            navigate("/settings/inbox");
          }}
        >
          <Settings size={14} strokeWidth={SW} />
          Notification preferences
        </button>
      </footer>
    </div>,
    document.body,
  );
}
