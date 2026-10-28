import { ChevronDown } from "lucide-react";
import { useState } from "react";
import {
  BANK_OPTIONS,
  CURRENCY_OPTIONS,
  type EmployeeDraft,
  PAY_FREQUENCY_OPTIONS,
  PAY_METHOD_OPTIONS,
} from "../../lib/team-dummy";
import { Select } from "../Select";
import { Field } from "../ui";

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
        <Field label="Pay frequency">
          <Select
            value={draft.payFrequency}
            onChange={(v) => set("payFrequency", v)}
            searchable={false}
            options={PAY_FREQUENCY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            placeholder="Select frequency"
            aria-label="Pay frequency"
          />
        </Field>
        <Field label="Currency">
          <Select
            value={draft.currency}
            onChange={(v) => set("currency", v)}
            searchable={false}
            options={CURRENCY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            aria-label="Currency"
          />
        </Field>
        <Field label="Basic salary (gross)" className="span-2" hint="Enter the gross salary before deductions.">
          <input className="input" value={draft.basicSalary} onChange={(e) => set("basicSalary", e.target.value)} placeholder="0.00" inputMode="decimal" />
        </Field>
        <Field label="Effective from" className="span-2">
          <input className="input" type="date" value={draft.effectiveFrom} onChange={(e) => set("effectiveFrom", e.target.value)} />
        </Field>
      </div>

      <h3 className="ee-team-step-title ee-team-step-title-spaced">Payment details</h3>
      <div className="ee-cust-grid ee-cust-grid-2">
        <Field label="Payment method">
          <Select
            value={draft.paymentMethod}
            onChange={(v) => set("paymentMethod", v)}
            searchable={false}
            options={PAY_METHOD_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            placeholder="Select method"
            aria-label="Payment method"
          />
        </Field>
        <Field label="Bank name">
          <Select
            value={draft.bankName}
            onChange={(v) => set("bankName", v)}
            searchable
            options={BANK_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            placeholder="Select bank"
            aria-label="Bank name"
          />
        </Field>
        <Field label="Account holder name">
          <input className="input" value={draft.accountHolder} onChange={(e) => set("accountHolder", e.target.value)} placeholder="Account holder name" />
        </Field>
        <Field label="Account number">
          <input className="input" value={draft.accountNumber} onChange={(e) => set("accountNumber", e.target.value)} placeholder="Account number" />
        </Field>
      </div>

      <h3 className="ee-team-step-title ee-team-step-title-spaced">Statutory details</h3>
      <div className="ee-cust-grid ee-cust-grid-2">
        <Field label="Tax identification number (TIN)">
          <input className="input" value={draft.tin} onChange={(e) => set("tin", e.target.value)} placeholder="TIN" />
        </Field>
        <Field label="RSSB number">
          <input className="input" value={draft.rssb} onChange={(e) => set("rssb", e.target.value)} placeholder="RSSB number" />
        </Field>
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
