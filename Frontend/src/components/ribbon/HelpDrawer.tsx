import {
  BarChart3,
  Building2,
  FileText,
  MessageCircle,
  Search,
  Send,
  X,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HELP_SUGGESTIONS } from "../../lib/ribbon-dummy";
import { navigate } from "../../lib/router";
import { useSession } from "../../lib/session";

const SW = 1.5;

type Tab = "assistant" | "search";

type Props = { open: boolean; onClose: () => void };

function firstName(email: string | undefined) {
  const local = (email ?? "").split("@")[0] || "there";
  const part = local.split(/[._-]+/).filter(Boolean)[0] ?? local;
  return part.charAt(0).toUpperCase() + part.slice(1).toLowerCase();
}

function initials(email: string | undefined) {
  const local = (email ?? "").split("@")[0];
  const parts = local.split(/[._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

const SUGGEST_ICONS = {
  file: FileText,
  bank: Building2,
  zap: Zap,
  chart: BarChart3,
} as const;

export function HelpDrawer({ open, onClose }: Props) {
  const { email } = useSession();
  const [tab, setTab] = useState<Tab>("assistant");
  const [question, setQuestion] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const name = useMemo(() => firstName(email), [email]);

  useEffect(() => {
    if (!open) return;
    setTab("assistant");
    setQuestion("");
    setSearchQ("");
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  function ask(text: string) {
    if (text.toLowerCase().includes("workflow")) {
      onClose();
      navigate("/workflows");
      return;
    }
    if (text.toLowerCase().includes("report")) {
      onClose();
      navigate("/reports/statements");
      return;
    }
    if (text.toLowerCase().includes("invoice")) {
      onClose();
      navigate("/invoices");
      return;
    }
    if (text.toLowerCase().includes("reconcile") || text.toLowerCase().includes("bank")) {
      onClose();
      navigate("/banking/reconciliation");
      return;
    }
    setQuestion(text);
  }

  return createPortal(
    <div className="ee-ribbon-drawer-root" role="presentation">
      <button type="button" className="ee-ribbon-drawer-scrim" aria-label="Close help" onClick={onClose} />
      <aside className="ee-ribbon-drawer ee-help-drawer" role="dialog" aria-modal="true" aria-labelledby="ee-help-title">
        <header className="ee-help-head">
          <div>
            <h2 id="ee-help-title">Excel Edge Help</h2>
            <p>Guidance for your daily work.</p>
          </div>
          <button type="button" className="ee-help-close" onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={SW} />
          </button>
        </header>

        <div className="ee-help-tabs" role="tablist" aria-label="Help sections">
          <button
            type="button"
            role="tab"
            aria-selected={tab === "assistant"}
            className={`ee-help-tab ${tab === "assistant" ? "active" : ""}`}
            onClick={() => setTab("assistant")}
          >
            <MessageCircle size={15} strokeWidth={SW} />
            Assistant
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "search"}
            className={`ee-help-tab ${tab === "search" ? "active" : ""}`}
            onClick={() => setTab("search")}
          >
            <Search size={15} strokeWidth={SW} />
            Search
          </button>
        </div>

        <div className="ee-help-body">
          {tab === "assistant" ? (
            <>
              <div className="ee-help-greeting">
                <span className="ee-help-avatar" aria-hidden="true">
                  {initials(email)}
                </span>
                <div className="ee-help-bubble">Hello {name}! How can I help you today?</div>
              </div>

              <div className="ee-help-suggest-label">Try a question</div>
              <ul className="ee-help-suggest">
                {HELP_SUGGESTIONS.map((s) => {
                  const Icon = SUGGEST_ICONS[s.icon];
                  return (
                    <li key={s.id}>
                      <button type="button" className="ee-help-suggest-btn" onClick={() => ask(s.label)}>
                        <Icon size={15} strokeWidth={SW} />
                        <span>{s.label}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>

              <button type="button" className="ee-help-contact">
                Contact support →
              </button>
            </>
          ) : (
            <label className="ee-help-search">
              <Search size={16} strokeWidth={SW} aria-hidden="true" />
              <input
                type="search"
                placeholder="Search help articles..."
                value={searchQ}
                onChange={(e) => setSearchQ(e.target.value)}
                aria-label="Search help"
              />
            </label>
          )}
        </div>

        <footer className="ee-help-foot">
          <div className="ee-help-input-row">
            <input
              ref={inputRef}
              type="text"
              className="ee-help-input"
              placeholder="Type your question..."
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && question.trim()) ask(question.trim());
              }}
              aria-label="Ask a question"
            />
            <button
              type="button"
              className="ee-help-send"
              aria-label="Send"
              disabled={!question.trim()}
              onClick={() => question.trim() && ask(question.trim())}
            >
              <Send size={16} strokeWidth={SW} />
            </button>
          </div>
          <p className="ee-help-foot-note">Product help and guidance.</p>
        </footer>
      </aside>
    </div>,
    document.body,
  );
}
