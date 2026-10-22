import { Play, X } from "lucide-react";
import { type CSSProperties, type RefObject, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { SETTINGS_MEGA_MENU } from "../../lib/ribbon-dummy";
import { navigate } from "../../lib/router";

const SW = 1.5;

type Props = {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLElement | null>;
};

export function SettingsMegaMenu({ open, onClose, anchorRef }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
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
        right: Math.max(12, Math.round(window.innerWidth - anchor.right - 20)),
      }
    : { top: 56, right: 48 };

  function go(to?: string, href?: string) {
    onClose();
    if (href) {
      window.location.assign(href);
      return;
    }
    if (to) navigate(to);
  }

  return createPortal(
    <div
      ref={panelRef}
      className="ee-settings-mega"
      style={style}
      role="dialog"
      aria-modal="true"
      aria-labelledby="ee-settings-mega-title"
    >
      <header className="ee-settings-mega-head">
        <h2 id="ee-settings-mega-title">Settings</h2>
        <button type="button" className="ee-customise-close" onClick={onClose} aria-label="Close">
          <X size={18} strokeWidth={SW} />
        </button>
      </header>

      <div className="ee-settings-mega-grid">
        {SETTINGS_MEGA_MENU.map((col) => (
          <div className="ee-settings-mega-col" key={col.title}>
            <div className="ee-settings-mega-col-title">{col.title}</div>
            <ul>
              {col.items.map((item) => (
                <li key={item.label}>
                  <button
                    type="button"
                    className={`ee-settings-mega-link ${item.accent ? "accent" : ""}`}
                    onClick={() => go(item.to, item.href)}
                  >
                    {item.label}
                    {item.accent && <span className="ee-settings-mega-dot" aria-hidden="true" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <footer className="ee-settings-mega-foot">
        <button type="button" className="ee-settings-mega-video">
          <span className="ee-settings-mega-play" aria-hidden="true">
            <Play size={12} strokeWidth={2.5} fill="currentColor" />
          </span>
          Video tutorials
        </button>
        <button type="button" className="ee-settings-mega-switch">
          Switch <strong>from Accountant view</strong> to Business view
        </button>
      </footer>
    </div>,
    document.body,
  );
}
