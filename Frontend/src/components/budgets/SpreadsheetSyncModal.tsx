import { Play, X } from "lucide-react";
import { useFeedback } from "../feedback";

type Props = {
  open: boolean;
  onClose: () => void;
};

export function SpreadsheetSyncModal({ open, onClose }: Props) {
  const { toast } = useFeedback();

  if (!open) return null;

  function handleLetsGo() {
    onClose();
    toast("Opening Excel Edge Spreadsheet Sync connection...");
  }

  return (
    <div className="ee-screen-share-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="ee-screen-share-dialog"
        style={{ width: 680, padding: "32px 32px 24px", textAlign: "left" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <span
              style={{
                display: "inline-block",
                backgroundColor: "#e0f2fe",
                color: "#0369a1",
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: "0.06em",
                padding: "4px 8px",
                borderRadius: 4,
                marginBottom: 8,
              }}
            >
              SPREADSHEET SYNC
            </span>
            <h2 style={{ fontSize: 24, fontWeight: 700, color: "#0c1c38", margin: "0 0 6px" }}>
              Connect Excel Edge ERP with Microsoft Excel
            </h2>
            <p style={{ fontSize: 14, color: "#475569", margin: "0 0 10px", lineHeight: 1.4 }}>
              Create and edit custom reports and budgets. Add or edit transactions, then sync your changes to Excel Edge ERP.
            </p>
            <a
              href="#see-how-it-works"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                color: "#0052ff",
                fontSize: 13.5,
                fontWeight: 600,
                textDecoration: "none",
              }}
              onClick={(e) => {
                e.preventDefault();
                toast("Spreadsheet Sync walkthrough video.");
              }}
            >
              See how it works <Play size={14} fill="#0052ff" />
            </a>
          </div>
          <button
            type="button"
            style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", padding: 4 }}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        {/* 3 Step Instruction Cards matching Mockup 80 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, margin: "24px 0" }}>
          {/* Card 1 */}
          <div
            style={{
              background: "#eff6ff",
              border: "1px solid #dbeafe",
              borderRadius: 10,
              padding: 16,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: "#0052ff",
                  color: "#ffffff",
                  fontSize: 12,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                1
              </span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#0c1c38" }}>
                Open Microsoft Excel
              </span>
            </div>
            <p style={{ fontSize: 12.5, color: "#475569", margin: "0 0 14px" }}>
              Allow your browser to open the link.
            </p>

            {/* Visual Graphic 1 */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                padding: "12px 10px",
                marginTop: "auto",
                boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444" }} />
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#f59e0b" }} />
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981" }} />
              </div>
              <div style={{ height: 8, background: "#e2e8f0", borderRadius: 4, width: "70%", marginBottom: 6 }} />
              <div style={{ height: 6, background: "#f1f5f9", borderRadius: 4, width: "90%", marginBottom: 12 }} />
              <div style={{ display: "flex", gap: 6 }}>
                <span style={{ background: "#0052ff", color: "#fff", fontSize: 10, fontWeight: 600, padding: "3px 8px", borderRadius: 4 }}>
                  Open Link
                </span>
                <span style={{ background: "#f1f5f9", color: "#475569", fontSize: 10, padding: "3px 8px", borderRadius: 4 }}>
                  Cancel
                </span>
              </div>
            </div>
          </div>

          {/* Card 2 */}
          <div
            style={{
              background: "#eff6ff",
              border: "1px solid #dbeafe",
              borderRadius: 10,
              padding: 16,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: "#0052ff",
                  color: "#ffffff",
                  fontSize: 12,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                2
              </span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#0c1c38" }}>
                Trust the add-in
              </span>
            </div>
            <p style={{ fontSize: 12.5, color: "#475569", margin: "0 0 14px" }}>
              In Excel, select Trust this add-in.
            </p>

            {/* Visual Graphic 2 */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                padding: "10px",
                marginTop: "auto",
                boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ background: "#16a34a", color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 6px", borderRadius: 3, display: "inline-block", marginBottom: 8 }}>
                XLS
              </div>
              <div style={{ height: 6, background: "#e2e8f0", borderRadius: 3, width: "80%", marginBottom: 12 }} />
              <div style={{ border: "1px solid #16a34a", background: "#f0fdf4", color: "#166534", fontSize: 10, fontWeight: 600, padding: "4px 8px", borderRadius: 4, textAlign: "center" }}>
                Trust this add-in
              </div>
            </div>
          </div>

          {/* Card 3 */}
          <div
            style={{
              background: "#eff6ff",
              border: "1px solid #dbeafe",
              borderRadius: 10,
              padding: 16,
              display: "flex",
              flexDirection: "column",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  background: "#0052ff",
                  color: "#ffffff",
                  fontSize: 12,
                  fontWeight: 700,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                3
              </span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "#0c1c38" }}>
                Sign in to Excel Edge
              </span>
            </div>
            <p style={{ fontSize: 12.5, color: "#475569", margin: "0 0 14px" }}>
              Use your Excel Edge ERP account to connect.
            </p>

            {/* Visual Graphic 3 */}
            <div
              style={{
                background: "#ffffff",
                border: "1px solid #cbd5e1",
                borderRadius: 8,
                padding: "10px",
                marginTop: "auto",
                boxShadow: "0 2px 6px rgba(0,0,0,0.04)",
                textAlign: "center",
              }}
            >
              <div style={{ color: "#d97706", fontSize: 11, fontWeight: 700, marginBottom: 6 }}>
                ⚜ EXCEL EDGE
              </div>
              <div style={{ height: 6, background: "#e2e8f0", borderRadius: 3, width: "70%", margin: "0 auto 6px" }} />
              <div style={{ background: "#0052ff", color: "#fff", fontSize: 10, fontWeight: 600, padding: "4px 8px", borderRadius: 4, display: "inline-block" }}>
                Sign in
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12, color: "#64748b", maxWidth: 440 }}>
            By selecting <strong>Let's go</strong>, you agree to our <a href="#terms" style={{ color: "#0052ff" }}>Terms</a> and acknowledge our <a href="#privacy" style={{ color: "#0052ff" }}>Privacy Policy</a>.
          </span>
          <button type="button" className="ee-btn-blue" onClick={handleLetsGo}>
            Let's go
          </button>
        </div>
      </div>
    </div>
  );
}
