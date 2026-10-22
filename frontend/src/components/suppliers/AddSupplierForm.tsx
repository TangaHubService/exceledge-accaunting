import { CircleHelp, Contact, MapPin, Paperclip, Settings2, Shield, StickyNote, Wrench } from "lucide-react";
import {
  SUPPLIER_TERMS,
  SUPPLIER_TITLE_OPTIONS,
  type SupplierDraft,
} from "../../lib/supplier-hub-dummy";
import { Select } from "../Select";
import { Field } from "../ui";
import { FormSection } from "../customers/FormSection";

type SetDraft = <K extends keyof SupplierDraft>(key: K, value: SupplierDraft[K]) => void;

type FormErrors = {
  displayName?: string;
  email?: string;
  website?: string;
};

export function AddSupplierForm({
  draft,
  set,
  errors = {},
  onBlurField,
}: {
  draft: SupplierDraft;
  set: SetDraft;
  errors?: FormErrors;
  onBlurField?: (key: keyof FormErrors) => void;
}) {
  return (
    <div className="ee-add-customer-body">
      <div id="section-contact">
        <FormSection title="Name and contact" icon={Contact}>
          <div className="ee-cust-grid ee-cust-grid-name">
            <Field label="Title">
              <Select
                value={draft.title}
                onChange={(v) => set("title", v)}
                searchable={false}
                options={SUPPLIER_TITLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
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
            <Field label="Supplier display name" required error={errors.displayName}>
              <input
                className="input"
                value={draft.displayName}
                onChange={(e) => set("displayName", e.target.value)}
                onBlur={() => onBlurField?.("displayName")}
              />
            </Field>
            <Field label="Company name">
              <input className="input" value={draft.companyName} onChange={(e) => set("companyName", e.target.value)} />
            </Field>
            <Field label="Email" error={errors.email}>
              <input
                className="input"
                type="email"
                value={draft.email}
                onChange={(e) => set("email", e.target.value)}
                onBlur={() => onBlurField?.("email")}
              />
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
            <Field label="Website" error={errors.website}>
              <input
                className="input"
                type="url"
                value={draft.website}
                onChange={(e) => set("website", e.target.value)}
                onBlur={() => onBlurField?.("website")}
                placeholder="https://"
              />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Additional info" icon={Settings2} defaultOpen>
          <div className="ee-cust-grid ee-cust-grid-2">
            <Field label="Business ID No. / Social Insurance No.">
              <input className="input" value={draft.businessId} onChange={(e) => set("businessId", e.target.value)} />
            </Field>
            <Field label="Billing rate (/hr)">
              <input className="input" value={draft.billingRate} onChange={(e) => set("billingRate", e.target.value)} />
            </Field>
            <Field label="Terms">
              <Select
                value={draft.terms}
                onChange={(v) => set("terms", v)}
                searchable={false}
                options={SUPPLIER_TERMS.map((o) => ({ value: o.value, label: o.label }))}
              />
            </Field>
            <Field label="Account no.">
              <input className="input" value={draft.accountNo} onChange={(e) => set("accountNo", e.target.value)} />
            </Field>
            <Field label="Default expense category">
              <Select
                value={draft.expenseCategory}
                onChange={(v) => set("expenseCategory", v)}
                searchable={false}
                options={[
                  { value: "", label: "Choose account" },
                  { value: "office", label: "Office supplies" },
                  { value: "cogs", label: "Cost of goods sold" },
                  { value: "utilities", label: "Utilities" },
                ]}
              />
            </Field>
          </div>
        </FormSection>

        <FormSection
          title="Opening balance"
          icon={CircleHelp}
          subtitle="Enter any amount you already owe this supplier."
        >
          <div className="ee-cust-grid ee-cust-grid-2">
            <Field label="Opening balance (RWF)">
              <input
                className="input"
                inputMode="decimal"
                value={draft.openingBalance}
                onChange={(e) => set("openingBalance", e.target.value)}
              />
            </Field>
            <Field label="As of">
              <input className="input" value={draft.asOf} onChange={(e) => set("asOf", e.target.value)} />
            </Field>
          </div>
        </FormSection>

        <FormSection title="Custom fields" icon={Settings2} defaultOpen={false}>
          <button type="button" className="ee-link-btn" style={{ padding: 0 }}>
            + Add custom field
          </button>
        </FormSection>

        <FormSection title="Privacy" icon={Shield} defaultOpen={false}>
          <p className="ee-form-section-sub" style={{ margin: 0 }}>
            Control who on your team can see this supplier.
          </p>
        </FormSection>
      </div>

      <div id="section-address">
        <FormSection title="Address" icon={MapPin}>
          <div className="ee-cust-grid ee-cust-grid-2">
            <Field label="Street address 1">
              <input className="input" value={draft.street1} onChange={(e) => set("street1", e.target.value)} />
            </Field>
            <Field label="Street address 2">
              <input className="input" value={draft.street2} onChange={(e) => set("street2", e.target.value)} />
            </Field>
            <div className="ee-cust-span-2">
              <button type="button" className="ee-link-btn" style={{ padding: 0 }}>
                Add lines
              </button>
            </div>
            <Field label="City">
              <input className="input" value={draft.city} onChange={(e) => set("city", e.target.value)} />
            </Field>
            <Field label="Province">
              <input className="input" value={draft.province} onChange={(e) => set("province", e.target.value)} />
            </Field>
            <Field label="Postal code">
              <input className="input" value={draft.postal} onChange={(e) => set("postal", e.target.value)} />
            </Field>
            <Field label="Country">
              <input className="input" value={draft.country} onChange={(e) => set("country", e.target.value)} />
            </Field>
          </div>
          <button type="button" className="ee-link-btn" style={{ padding: 0, marginTop: 8 }}>
            Preview address
          </button>
        </FormSection>
      </div>

      <div id="section-notes">
        <FormSection title="Notes and attachments" icon={StickyNote}>
          <Field label="Notes">
            <textarea
              className="input"
              rows={4}
              value={draft.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Internal notes about this supplier"
            />
          </Field>
          <div className="ee-attach-box">
            <Paperclip size={16} strokeWidth={1.5} aria-hidden="true" />
            <div>
              <button type="button" className="ee-link-btn" style={{ padding: 0 }}>
                Add attachment
              </button>
              <div className="ee-settings-hint">Max file size: 20 MB</div>
            </div>
          </div>
        </FormSection>
      </div>

      <div id="section-documents">
        <FormSection title="Documents" icon={Paperclip}>
          <div className="ee-attach-box">
            <Paperclip size={16} strokeWidth={1.5} aria-hidden="true" />
            <div>
              <button type="button" className="ee-link-btn" style={{ padding: 0 }}>
                Add attachment
              </button>
              <div className="ee-settings-hint">Max file size: 20 MB</div>
            </div>
          </div>
        </FormSection>
      </div>

      <div id="section-tools">
        <FormSection title="Tools" icon={Wrench} defaultOpen={false}>
          <p className="ee-form-section-sub" style={{ margin: 0 }}>
            Extra supplier tools and integrations will appear here.
          </p>
        </FormSection>
      </div>
    </div>
  );
}
