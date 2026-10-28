import { MapPin } from "lucide-react";
import type { CustomerDraft } from "../../../lib/customer-hub-dummy";
import { Field } from "../../ui";
import { FormSection } from "../FormSection";

export function AddressTab({
  draft,
  set,
}: {
  draft: CustomerDraft;
  set: <K extends keyof CustomerDraft>(key: K, value: CustomerDraft[K]) => void;
}) {
  return (
    <FormSection title="Addresses" icon={MapPin}>
      <div className="ee-address-block">
        <h4 className="ee-address-label">Billing address</h4>
        <div className="ee-cust-grid ee-cust-grid-2">
          <Field label="Street address 1" className="span-2">
            <input className="input" value={draft.billingStreet1} onChange={(e) => set("billingStreet1", e.target.value)} />
          </Field>
          <Field label="Street address 2" className="span-2">
            <input className="input" value={draft.billingStreet2} onChange={(e) => set("billingStreet2", e.target.value)} />
          </Field>
          <button type="button" className="ee-link-btn">
            + Add lines
          </button>
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
  );
}
