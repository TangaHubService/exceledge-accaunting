import { CircleHelp, CreditCard } from "lucide-react";
import {
  type CustomerDraft,
  DELIVERY_OPTIONS,
  LANGUAGES,
  PAYMENT_METHODS,
  PAYMENT_TERMS,
} from "../../../lib/customer-hub-dummy";
import { Select } from "../../Select";
import { Field } from "../../ui";
import { FormSection } from "../FormSection";

export function PaymentTab({
  draft,
  set,
}: {
  draft: CustomerDraft;
  set: <K extends keyof CustomerDraft>(key: K, value: CustomerDraft[K]) => void;
}) {
  return (
    <>
      <FormSection title="Payments" icon={CreditCard}>
        <div className="ee-cust-grid ee-cust-grid-2">
          <Field label="Primary payment method">
            <Select
              value={draft.paymentMethod}
              onChange={(v) => set("paymentMethod", v)}
              searchable={false}
              options={PAYMENT_METHODS.map((o) => ({ value: o.value, label: o.label }))}
            />
          </Field>
          <Field label="Terms">
            <Select
              value={draft.terms}
              onChange={(v) => set("terms", v)}
              searchable={false}
              options={PAYMENT_TERMS.map((o) => ({ value: o.value, label: o.label }))}
            />
          </Field>
          <Field label="Sales form delivery options">
            <Select
              value={draft.deliveryOption}
              onChange={(v) => set("deliveryOption", v)}
              searchable={false}
              options={DELIVERY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
          </Field>
          <Field label="Language to use when sending invoices">
            <Select
              value={draft.language}
              onChange={(v) => set("language", v)}
              searchable={false}
              options={LANGUAGES.map((o) => ({ value: o.value, label: o.label }))}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Additional info" defaultOpen>
        <p className="ee-form-section-sub" style={{ marginTop: 0 }}>
          Sales tax
        </p>
        <div className="ee-cust-grid ee-cust-grid-2">
          <Field label="Sales tax registration" className="span-2">
            <input className="input" value={draft.salesTaxReg} onChange={(e) => set("salesTaxReg", e.target.value)} />
          </Field>
          <Field
            label={
              <span className="ee-label-with-tip">
                Opening balance (RWF)
                <CircleHelp size={13} strokeWidth={1.5} aria-hidden="true" />
              </span>
            }
          >
            <input
              className="input num"
              value={draft.openingBalance}
              onChange={(e) => set("openingBalance", e.target.value)}
              inputMode="decimal"
            />
          </Field>
          <Field label="As of">
            <input className="input" type="date" value={draft.asOf} onChange={(e) => set("asOf", e.target.value)} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Custom fields" defaultOpen={false} subtitle="Add customer details to sort, filter and report.">
        <button type="button" className="ee-link-btn">
          + Add custom field
        </button>
      </FormSection>
    </>
  );
}
