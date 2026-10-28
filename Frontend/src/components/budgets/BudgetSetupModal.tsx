import { CheckCircle2, HelpCircle, X } from "lucide-react";
import { useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  onNext: (config: {
    type: string;
    period: string;
    format: string;
    prefill: string;
  }) => void;
  onOpenSpreadsheetSync: () => void;
};

export function BudgetSetupModal({
  open,
  onClose,
  onNext,
  onOpenSpreadsheetSync,
}: Props) {
  const [budgetType, setBudgetType] = useState("Profit and loss");
  const [period, setPeriod] = useState("FY 2026 (Jan 2026 - Dec 2026)");
  const [format, setFormat] = useState("Consolidated");
  const [prefill, setPrefill] = useState("");

  if (!open) return null;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onNext({ type: budgetType, period, format, prefill });
  }

  return (
    <div className="ee-screen-share-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="ee-screen-share-dialog"
        style={{ width: 880, maxWidth: "95vw", padding: "32px 36px 24px", textAlign: "left" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0c1c38", margin: 0 }}>
            Create a budget
          </h2>
          <button
            type="button"
            style={{ background: "none", border: "none", cursor: "pointer", color: "#64748b", padding: 4 }}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content 2-column: Left Form, Right Illustration */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 32, alignItems: "center" }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0c1c38", margin: "0 0 6px", letterSpacing: "-0.02em" }}>
              How do you want to set up your budget?
            </h1>
            <p style={{ fontSize: 14, color: "#475569", margin: "0 0 20px" }}>
              Select your preferred options
            </p>

            <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {/* Budget type */}
              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "#1e293b" }}>Budget type</span>
                <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, color: "#0c1c38", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="budgetType"
                    checked={budgetType === "Profit and loss"}
                    onChange={() => setBudgetType("Profit and loss")}
                  />
                  <span>Profit and loss</span>
                  <HelpCircle size={14} color="#64748b" />
                </label>
              </div>

              {/* Period */}
              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "#1e293b" }}>Period</span>
                <select
                  className="ee-input-field"
                  value={period}
                  onChange={(e) => setPeriod(e.target.value)}
                >
                  <option value="FY 2026 (Jan 2026 - Dec 2026)">FY 2026 (Jan 2026 - Dec 2026)</option>
                  <option value="FY 2025 (Jan 2025 - Dec 2025)">FY 2025 (Jan 2025 - Dec 2025)</option>
                  <option value="FY 2027 (Jan 2027 - Dec 2027)">FY 2027 (Jan 2027 - Dec 2027)</option>
                </select>
              </div>

              {/* Budget format */}
              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "#1e293b" }}>Budget format</span>
                <div style={{ display: "flex", gap: 16 }}>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, color: "#0c1c38", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="format"
                      checked={format === "Consolidated"}
                      onChange={() => setFormat("Consolidated")}
                    />
                    <span>Consolidated</span>
                    <HelpCircle size={14} color="#64748b" />
                  </label>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, color: "#0c1c38", cursor: "pointer" }}>
                    <input
                      type="radio"
                      name="format"
                      checked={format === "Subdivided"}
                      onChange={() => setFormat("Subdivided")}
                    />
                    <span>Subdivided</span>
                    <HelpCircle size={14} color="#64748b" />
                  </label>
                </div>
              </div>

              {/* Pre-fill data */}
              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", alignItems: "center", gap: 12 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600, color: "#1e293b" }}>Pre-fill data</span>
                <select
                  className="ee-input-field"
                  value={prefill}
                  onChange={(e) => setPrefill(e.target.value)}
                >
                  <option value="">(Optional) Select...</option>
                  <option value="actuals-2025">Actuals 2025</option>
                  <option value="budget-2025">Budget FY 2025</option>
                  <option value="average-last-year">Monthly average last year</option>
                </select>
              </div>

              {/* Available setup option card */}
              <div style={{ marginTop: 8 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#1e293b", marginBottom: 8 }}>
                  Available setup option
                </div>
                <div className="ee-budget-setup-option-card">
                  <div className="check-circle">
                    <CheckCircle2 size={18} fill="#0052ff" color="#ffffff" />
                  </div>
                  {/* Geometric icon: circle, triangle, diamond, square */}
                  <div style={{ display: "grid", gridTemplateColumns: "16px 16px", gap: 6, justifyContent: "center", margin: "0 auto 10px" }}>
                    <span style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid #0052ff" }} />
                    <span style={{ width: 0, height: 0, borderLeft: "7px solid transparent", borderRight: "7px solid transparent", borderBottom: "14px solid #0052ff" }} />
                    <span style={{ width: 12, height: 12, transform: "rotate(45deg)", border: "2px solid #0052ff", margin: "1px" }} />
                    <span style={{ width: 13, height: 13, border: "2px solid #0052ff" }} />
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: "#0c1c38" }}>Custom budgets</div>
                  <div style={{ fontSize: 12, color: "#64748b" }}>Create a budget from scratch</div>
                </div>
              </div>

              <div style={{ marginTop: 4 }}>
                <button
                  type="button"
                  style={{ background: "none", border: "none", color: "#0052ff", fontSize: 13.5, fontWeight: 600, cursor: "pointer", padding: 0 }}
                  onClick={onOpenSpreadsheetSync}
                >
                  Create budget in spreadsheet
                </button>
              </div>
            </form>
          </div>

          {/* Right Illustration */}
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
            <img
              src="/illustrations/budget-setup-hero.png"
              alt="Budget setup illustration"
              style={{ maxWidth: "100%", maxHeight: 380, objectFit: "contain" }}
              onError={(e) => {
                (e.target as HTMLElement).style.display = "none";
              }}
            />
          </div>
        </div>

        {/* Footer */}
        <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: 16, marginTop: 24, display: "flex", justifyContent: "flex-end", gap: 12 }}>
          <button type="button" className="ee-btn-outline" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="ee-btn-blue" onClick={handleSubmit}>
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
