import { Info, Link2, RefreshCw, X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

const SW = 1.5;

type Props = { open: boolean; onClose: () => void };

export function IntegrationsModal({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return;
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
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="ee-modal-root" role="presentation">
      <button type="button" className="ee-modal-backdrop" aria-label="Close integrations" onClick={onClose} />
      <div
        className="ee-integrations-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ee-integrations-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="ee-integrations-head">
          <div className="ee-integrations-title-row">
            <h2 id="ee-integrations-title">My integrations</h2>
            <Info size={15} strokeWidth={SW} className="ee-integrations-info" aria-hidden="true" />
          </div>
          <button type="button" className="ee-customise-close" onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={SW} />
          </button>
        </header>

        <div className="ee-integrations-body">
          <div className="ee-integrations-art" aria-hidden="true">
            <span className="ee-integrations-tile">
              <RefreshCw size={22} strokeWidth={1.75} color="#fff" />
            </span>
            <Link2 size={18} strokeWidth={SW} className="ee-integrations-link-icon" />
            <span className="ee-integrations-tile ee-integrations-tile-empty" />
          </div>
          <h3>Connect more. Do less manually.</h3>
          <p>Bring your business tools together with Excel Edge ERP. No integrations connected yet.</p>
          <button type="button" className="ee-btn-primary ee-integrations-cta">
            Explore integrations →
          </button>
          <p className="ee-integrations-hint">Choose the services you want to connect.</p>
        </div>
      </div>
    </div>,
    document.body,
  );
}
