import { CircleHelp, Link2 } from "lucide-react";
import {
  CONTACT_METHODS,
  type CustomerDraft,
  INDUSTRIES,
  ROLE_OPTIONS,
  SOURCE_OPTIONS,
} from "../../../lib/customer-hub-dummy";
import { Select } from "../../Select";
import { Field } from "../../ui";
import { FormSection } from "../FormSection";

export function RelationshipsTab({
  draft,
  set,
}: {
  draft: CustomerDraft;
  set: <K extends keyof CustomerDraft>(key: K, value: CustomerDraft[K]) => void;
}) {
  return (
    <>
      <div className="ee-cust-grid ee-cust-grid-2" style={{ marginBottom: 16 }}>
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

      <FormSection title="Custom fields" defaultOpen={false} subtitle="Add customer details to sort, filter and report.">
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
    </>
  );
}
