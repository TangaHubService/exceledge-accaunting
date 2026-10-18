import {
  CircleHelp,
  Contact,
  CreditCard,
  FolderOpen,
  Link2,
  MapPin,
  Paperclip,
  Shield,
  StickyNote,
  Wrench,
} from "lucide-react";
import {
  CONTACT_METHODS,
  type CustomerDraft,
  DELIVERY_OPTIONS,
  INDUSTRIES,
  LANGUAGES,
  PAYMENT_METHODS,
  PAYMENT_TERMS,
  ROLE_OPTIONS,
  SOURCE_OPTIONS,
  TITLE_OPTIONS,
} from "../../lib/customer-hub-dummy";
import { Select } from "../Select";
import { Field } from "../ui";
import { FormSection } from "./FormSection";

type SetDraft = <K extends keyof CustomerDraft>(key: K, value: CustomerDraft[K]) => void;

/** Full Add customer form — all mock sections in scroll order. */
export function AddCustomerForm({ draft, set }: { draft: CustomerDraft; set: SetDraft }) {
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

        <FormSection title="Customer" icon={Contact}>
          <label className="check">
            <input type="checkbox" checked={draft.isSubCustomer} onChange={(e) => set("isSubCustomer", e.target.checked)} />
            <span>Is a sub-customer</span>
          </label>
        </FormSection>

        <FormSection title="Communication permissions" icon={Shield}>
          <div className="ee-comm-note">
            <Shield size={18} strokeWidth={1.5} aria-hidden="true" />
            <p>Enter an email to record customer consent for marketing emails. Transactional emails still send without consent.</p>
          </div>
        </FormSection>
      </div>

      <div id="section-address">
        <FormSection title="Addresses" icon={MapPin}>
          <div className="ee-address-block">
            <h4 className="ee-address-label">Billing address</h4>
            <div className="ee-cust-grid ee-cust-grid-2">
              <Field label="Street address 1" className="span-2">
                <input className="input" value={draft.billingStreet1} onChange={(e) => set("billingStreet1", e.target.value)} />
              </Field>
              <button type="button" className="ee-link-btn span-2">
                + Add lines
              </button>
              <Field label="Street address 2" className="span-2">
                <input className="input" value={draft.billingStreet2} onChange={(e) => set("billingStreet2", e.target.value)} />
              </Field>
              <Field label="City">
                <input className="input" value={draft.billingCity} onChange={(e) => set("billingCity", e.target.value)} />
              </Field>
              <Field label="Province">
                <input className="input" value={draft.billingProvince} onChange={(e) => set("billingProvince", e.target.value)} />
              </Field>
              <Field label="Postal code">
                <input className="input" value={draft.billingPostal} onChange={(e) => set("billingPostal", e.target.value)} />
              </Field>
              <Field label="Country">
                <input className="input" value={draft.billingCountry} onChange={(e) => set("billingCountry", e.target.value)} />
              </Field>
            </div>
            <button type="button" className="ee-link-btn" style={{ marginTop: 8 }}>
              Preview address
            </button>
          </div>

          <div className="ee-address-block" style={{ marginTop: 20 }}>
            <h4 className="ee-address-label">Shipping address</h4>
            <label className="check">
              <input type="checkbox" checked={draft.sameAsBilling} onChange={(e) => set("sameAsBilling", e.target.checked)} />
              <span>Same as billing address</span>
            </label>
          </div>
        </FormSection>
      </div>

      <div id="section-notes">
        <FormSection title="Notes and attachments" icon={StickyNote}>
          <Field label="Notes" className="span-2">
            <textarea
              className="input ee-notes-area"
              rows={5}
              value={draft.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
          <div className="ee-attach-zone">
            <Paperclip size={16} strokeWidth={1.5} aria-hidden="true" />
            <div>
              <button type="button" className="ee-link-btn">
                Add attachment
              </button>
              <p className="muted small">Max file size: 20 MB</p>
            </div>
          </div>
        </FormSection>
      </div>

      <div id="section-payment">
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

        <FormSection title="Additional info">
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
      </div>

      <div id="section-documents">
        <FormSection title="Documents" icon={FolderOpen}>
          <div className="ee-attach-zone">
            <div>
              <button type="button" className="ee-link-btn">
                Upload document
              </button>
              <p className="muted small">Contracts, ID and other files. Max 20 MB each.</p>
            </div>
          </div>
        </FormSection>
      </div>

      <div id="section-tools">
        <FormSection title="Tools" icon={Wrench}>
          <p className="ee-form-section-sub" style={{ marginTop: 0 }}>
            Shortcuts for this customer once they are saved.
          </p>
          <ul className="ee-dummy-list">
            <li>Create invoice</li>
            <li>Receive payment</li>
            <li>Send statement</li>
            <li>Print packing slip</li>
          </ul>
        </FormSection>
      </div>

      <div id="section-relationships">
        <FormSection title="Custom fields" subtitle="Add customer details to sort, filter and report.">
          <button type="button" className="ee-link-btn">
            + Add custom field
          </button>
        </FormSection>

        <FormSection title="Relationships & Sales" icon={Link2}>
          <div className="ee-cust-grid ee-cust-grid-2">
            <Field label="Sources">
              <Select
                value={draft.source}
                onChange={(v) => set("source", v)}
                searchable={false}
                options={SOURCE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
            </Field>
            <Field label="Referred by">
              <input className="input" value={draft.referredBy} onChange={(e) => set("referredBy", e.target.value)} />
            </Field>
            <Field label="Job title">
              <input className="input" value={draft.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} />
            </Field>
            <Field label="Role">
              <Select
                value={draft.role}
                onChange={(v) => set("role", v)}
                searchable={false}
                options={ROLE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              />
            </Field>
            <Field label="Preferred contact method">
              <Select
                value={draft.preferredContact}
                onChange={(v) => set("preferredContact", v)}
                searchable={false}
                options={CONTACT_METHODS.map((o) => ({ value: o.value, label: o.label }))}
              />
            </Field>
            <Field
              label="Industry"
              hint="Select the category that best describes what you do. Change this any time in Settings."
            >
              <Select
                value={draft.industry}
                onChange={(v) => set("industry", v)}
                searchable={false}
                options={INDUSTRIES.map((o) => ({ value: o.value, label: o.label }))}
              />
            </Field>
          </div>
          <div className="ee-social-box">
            <button type="button" className="ee-link-btn">
              + Add new social profile
            </button>
          </div>
        </FormSection>
      </div>
    </div>
  );
}
