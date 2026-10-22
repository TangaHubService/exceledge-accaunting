import { Check, Filter, Maximize2, MoreVertical, Plus, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { INBOX_INTRO_KEY, INBOX_SAMPLE } from "../../lib/ribbon-dummy";
import { navigate } from "../../lib/router";

const SW = 1.5;

type Tab = "needs" | "waiting" | "all";

type Props = { open: boolean; onClose: () => void };

export function InboxDrawer({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("needs");
  const [query, setQuery] = useState("");
  const [showIntro, setShowIntro] = useState(false);

  function dismissIntro() {
    try {
      localStorage.setItem(INBOX_INTRO_KEY, "1");
    } catch {
      /* ignore */
    }
    setShowIntro(false);
  }

  useEffect(() => {
    if (!open) return;
    setTab("needs");
    setQuery("");
    try {
      if (!localStorage.getItem(INBOX_INTRO_KEY)) setShowIntro(true);
    } catch {
      setShowIntro(true);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      try {
        if (!localStorage.getItem(INBOX_INTRO_KEY)) {
          dismissIntro();
          return;
        }
      } catch {
        /* ignore */
      }
      onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const messages = INBOX_SAMPLE.filter((m) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      m.subject.toLowerCase().includes(q) ||
      m.sender.toLowerCase().includes(q) ||
      m.preview.toLowerCase().includes(q)
    );
  });

  return createPortal(
    <div className="ee-ribbon-drawer-root" role="presentation">
      <button type="button" className="ee-ribbon-drawer-scrim" aria-label="Close inbox" onClick={onClose} />
      <aside className="ee-ribbon-drawer ee-inbox-drawer" role="dialog" aria-modal="true" aria-labelledby="ee-inbox-title">
        <header className="ee-inbox-head">
          <h2 id="ee-inbox-title">Inbox</h2>
          <div className="ee-inbox-head-actions">
            <button type="button" className="ee-customise-close" aria-label="Expand" title="Expand">
              <Maximize2 size={16} strokeWidth={SW} />
            </button>
            <button type="button" className="ee-customise-close" aria-label="More" title="More">
              <MoreVertical size={16} strokeWidth={SW} />
            </button>
            <button type="button" className="ee-customise-close" onClick={onClose} aria-label="Close">
              <X size={18} strokeWidth={SW} />
            </button>
          </div>
        </header>

        <div className="ee-inbox-toolbar">
          <button type="button" className="ee-btn-primary ee-inbox-new">
            <Plus size={16} strokeWidth={2.25} />
            New
          </button>
          <label className="ee-inbox-search">
            <Search size={15} strokeWidth={SW} aria-hidden="true" />
            <input
              type="search"
              placeholder="Search conversations..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search conversations"
            />
          </label>
          <button type="button" className="ee-customise-close" aria-label="Filter">
            <Filter size={16} strokeWidth={SW} />
          </button>
        </div>

        <div className="ee-inbox-tabs" role="tablist" aria-label="Inbox filters">
          {(
            [
              ["needs", "Needs action"],
              ["waiting", "Waiting"],
              ["all", "All"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              className={`ee-inbox-tab ${tab === key ? "active" : ""}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="ee-inbox-body">
          {messages.length === 0 ? (
            <p className="ee-inbox-empty">No conversations in this view.</p>
          ) : (
            <ul className="ee-inbox-list">
              {messages.map((m) => (
                <li key={m.id}>
                  <button type="button" className="ee-inbox-item">
                    <span className="ee-inbox-avatar" aria-hidden="true">
                      {m.initials}
                    </span>
                    <span className="ee-inbox-item-main">
                      <span className="ee-inbox-item-top">
                        <strong>{m.sender}</strong>
                        {m.badge && <span className="ee-inbox-badge">{m.badge}</span>}
                        <span className="ee-inbox-date">{m.date}</span>
                      </span>
                      <span className="ee-inbox-subject">{m.subject}</span>
                      <span className="ee-inbox-preview">{m.preview}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>

      {showIntro && (
        <div className="ee-modal-root ee-inbox-intro-root" role="presentation">
          <button type="button" className="ee-modal-backdrop" aria-label="Close intro" onClick={dismissIntro} />
          <div
            className="ee-inbox-intro"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ee-inbox-intro-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button type="button" className="ee-customise-close ee-inbox-intro-close" onClick={dismissIntro} aria-label="Close">
              <X size={18} strokeWidth={SW} />
            </button>
            <div className="ee-inbox-intro-grid">
              <div>
                <h2 id="ee-inbox-intro-title">Explore Inbox</h2>
                <p className="ee-inbox-intro-lead">Keep all your conversations in one place.</p>
                <ul className="ee-inbox-intro-list">
                  <li>
                    <Check size={16} strokeWidth={2.5} />
                    Message your team and accountants
                  </li>
                  <li>
                    <Check size={16} strokeWidth={2.5} />
                    Connect email and customer information
                  </li>
                  <li>
                    <Check size={16} strokeWidth={2.5} />
                    Reply to customers with the context you need
                  </li>
                </ul>
                <div className="ee-inbox-intro-actions">
                  <button
                    type="button"
                    className="ee-btn-outline"
                    onClick={() => {
                      dismissIntro();
                      onClose();
                      navigate("/settings/inbox");
                    }}
                  >
                    Set up Inbox
                  </button>
                  <button type="button" className="ee-btn-primary" onClick={dismissIntro}>
                    Show me around
                  </button>
                </div>
              </div>
              <div className="ee-inbox-intro-art" aria-hidden="true">
                <span className="ee-inbox-bubble ee-inbox-bubble-1" />
                <span className="ee-inbox-bubble ee-inbox-bubble-2" />
                <span className="ee-inbox-bubble ee-inbox-bubble-3" />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
