import { Contact, Shield } from "lucide-react";
import {
  type CustomerDraft,
  TITLE_OPTIONS,
} from "../../../lib/customer-hub-dummy";
import { Select } from "../../Select";
import { Field } from "../../ui";
import { FormSection } from "../FormSection";

export function ContactTab({
  draft,
  set,
}: {
  draft: CustomerDraft;
  set: <K extends keyof CustomerDraft>(key: K, value: CustomerDraft[K]) => void;
}) {
  return (
    <>
      <FormSection title="Name and contact" icon={Contact}>
        <div className="ee-cust-grid ee-cust-grid-name">
          <Field label="Title">
            <Select
              value={draft.title}
              onChange={(v) => set("title", v)}
              searchable={false}
              options={TITLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            />
          </Field>
          <Field label="First name">
            <input className="input" value={draft.firstName} onChange={(e) => set("firstName", e.target.value)} />
          </Field>
          <Field label="Middle name">
            <input className="input" value={draft.middleName} onChange={(e) => set("middleName", e.target.value)} />
          </Field>
          <Field label="Last name">
            <input className="input" value={draft.lastName} onChange={(e) => set("lastName", e.target.value)} />
          </Field>
          <Field label="Suffix">
            <input className="input" value={draft.suffix} onChange={(e) => set("suffix", e.target.value)} />
          </Field>
        </div>

        <div className="ee-cust-grid ee-cust-grid-2" style={{ marginTop: 12 }}>
          <Field label="Customer display name" required>
            <input
              className="input"
              value={draft.displayName}
              onChange={(e) => set("displayName", e.target.value)}
              required
            />
          </Field>
          <Field label="Company name">
            <input className="input" value={draft.companyName} onChange={(e) => set("companyName", e.target.value)} />
          </Field>
          <Field label="Email">
            <input className="input" type="email" value={draft.email} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="Phone number">
            <input className="input" type="tel" value={draft.phone} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="Cc">
            <input className="input" value={draft.cc} onChange={(e) => set("cc", e.target.value)} />
          </Field>
          <Field label="Bcc">
            <input className="input" value={draft.bcc} onChange={(e) => set("bcc", e.target.value)} />
          </Field>
          <Field label="Mobile number">
            <input className="input" type="tel" value={draft.mobile} onChange={(e) => set("mobile", e.target.value)} />
          </Field>
          <Field label="Fax">
            <input className="input" value={draft.fax} onChange={(e) => set("fax", e.target.value)} />
          </Field>
          <Field label="Other">
            <input className="input" value={draft.other} onChange={(e) => set("other", e.target.value)} />
          </Field>
          <Field label="Website">
            <input className="input" type="url" value={draft.website} onChange={(e) => set("website", e.target.value)} />
          </Field>
        </div>
      </FormSection>

      <FormSection title="Customer" icon={Contact} defaultOpen>
        <label className="check">
          <input type="checkbox" checked={draft.isSubCustomer} onChange={(e) => set("isSubCustomer", e.target.checked)} />
          <span>Is a sub-customer</span>
        </label>
      </FormSection>

      <FormSection title="Communication permissions" icon={Shield} defaultOpen>
        <div className="ee-comm-note">
          <Shield size={18} strokeWidth={1.5} aria-hidden="true" />
          <p>
            Collect consent before sending marketing emails. Transactional emails about invoices and payments are always
            allowed.
          </p>
        </div>
      </FormSection>
    </>
  );
}
