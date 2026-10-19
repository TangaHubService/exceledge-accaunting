import { ChevronDown } from "lucide-react";
import { useState } from "react";
import {
  BANK_OPTIONS,
  CURRENCY_OPTIONS,
  type EmployeeDraft,
  PAY_FREQUENCY_OPTIONS,
  PAY_METHOD_OPTIONS,
} from "../../lib/team-dummy";

export function EmployeePayrollStep({
  draft,
  set,
}: {
  draft: EmployeeDraft;
  set: <K extends keyof EmployeeDraft>(key: K, value: EmployeeDraft[K]) => void;
}) {
  const [allowancesOpen, setAllowancesOpen] = useState(false);

  return (
    <div className="ee-team-step">
      <h3 className="ee-team-step-title">Payroll details</h3>
      <div className="ee-cust-grid ee-cust-grid-2">
        <label className="field">
          <span>Pay frequency</span>
          <select className="input" value={draft.payFrequency} onChange={(e) => set("payFrequency", e.target.value)}>
            {PAY_FREQUENCY_OPTIONS.map((o) => (
              <option key={o.value || "f"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Currency</span>
          <select className="input" value={draft.currency} onChange={(e) => set("currency", e.target.value)}>
            {CURRENCY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field span-2">
          <span>Basic salary (gross)</span>
          <input className="input" value={draft.basicSalary} onChange={(e) => set("basicSalary", e.target.value)} placeholder="0.00" inputMode="decimal" />
          <span className="ee-field-hint">Enter the gross salary before deductions.</span>
        </label>
        <label className="field span-2">
          <span>Effective from</span>
          <input className="input" type="date" value={draft.effectiveFrom} onChange={(e) => set("effectiveFrom", e.target.value)} />
        </label>
      </div>

      <h3 className="ee-team-step-title ee-team-step-title-spaced">Payment details</h3>
      <div className="ee-cust-grid ee-cust-grid-2">
        <label className="field">
          <span>Payment method</span>
          <select className="input" value={draft.paymentMethod} onChange={(e) => set("paymentMethod", e.target.value)}>
            {PAY_METHOD_OPTIONS.map((o) => (
              <option key={o.value || "pm"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Bank name</span>
          <select className="input" value={draft.bankName} onChange={(e) => set("bankName", e.target.value)}>
            {BANK_OPTIONS.map((o) => (
              <option key={o.value || "b"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Account holder name</span>
          <input className="input" value={draft.accountHolder} onChange={(e) => set("accountHolder", e.target.value)} placeholder="Account holder name" />
        </label>
        <label className="field">
          <span>Account number</span>
          <input className="input" value={draft.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} placeholder="Account number" />
        </label>
      </div>

      <h3 className="ee-team-step-title ee-team-step-title-spaced">Statutory details</h3>
      <div className="ee-cust-grid ee-cust-grid-2">
        <label className="field">
          <span>Tax identification number (TIN)</span>
          <input className="input" value={draft.tin} onChange={(e) => set("tin", e.target.value)} placeholder="TIN" />
        </label>
        <label className="field">
          <span>RSSB number</span>
          <input className="input" value={draft.rssb} onChange={(e) => set("rssb", e.target.value)} placeholder="RSSB number" />
        </label>
      </div>

      <button
        type="button"
        className={`ee-team-optional ${allowancesOpen ? "open" : ""}`}
        onClick={() => setAllowancesOpen((v) => !v)}
        aria-expanded={allowancesOpen}
      >
        <span>Allowances and deductions (optional)</span>
        <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" />
      </button>
      {allowancesOpen && (
        <p className="muted small" style={{ marginTop: 8 }}>
          Allowances and deductions can be configured after the employee is saved.
        </p>
      )}
    </div>
  );
}
