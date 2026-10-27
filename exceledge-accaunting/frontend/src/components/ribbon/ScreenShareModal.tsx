import { ChevronDown, ChevronUp, Monitor, X } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "../feedback";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function ScreenShareModal({ open, onClose }: Props) {
  const [expanded, setExpanded] = useState(false);
  const { toast } = useFeedback();

  if (!open) return null;

  function handleShare() {
    onClose();
    toast("Screen sharing session initiated with Excel Edge ERP support.");
  }

  return (
    <div className="ee-screen-share-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="ee-screen-share-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="ee-screen-share-icon-wrap" aria-hidden="true">
          <Monitor size={42} strokeWidth={1.75} />
        </div>

        <h2 className="ee-screen-share-title">
          Share your screen with Excel Edge ERP support
        </h2>

        <div className="ee-screen-share-accordion">
          <div
            className="ee-screen-share-accordion-head"
            onClick={() => setExpanded((prev) => !prev)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") setExpanded((prev) => !prev);
            }}
          >
            <span>Learn about screen sharing permissions</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "#0052ff", fontSize: 13 }}>
              {expanded ? "Hide" : "Show"}
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </span>
          </div>
          {expanded && (
            <div className="ee-screen-share-accordion-body">
              Granting screen sharing allows a verified Excel Edge support specialist to view your active application workspace in real time to assist with troubleshooting, configuration, or transaction verification. No private credentials or keystrokes outside this browser window are captured or stored. You may end the session at any moment.
            </div>
          )}
        </div>

        <div className="ee-screen-share-actions">
          <button type="button" className="ee-btn-outline" onClick={onClose}>
            Deny
          </button>
          <button type="button" className="ee-btn-blue" onClick={handleShare}>
            Share
          </button>
        </div>
      </div>
    </div>
  );
}
