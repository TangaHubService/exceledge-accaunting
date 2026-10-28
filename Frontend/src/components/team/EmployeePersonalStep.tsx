import { Camera } from "lucide-react";
import { COUNTRY_OPTIONS, type EmployeeDraft, GENDER_OPTIONS } from "../../lib/team-dummy";
import { Select } from "../Select";
import { Field } from "../ui";

type FormErrors = {
  firstName?: string;
  lastName?: string;
  email?: string;
};

export function EmployeePersonalStep({
  draft,
  set,
  errors = {},
  onBlurField,
}: {
  draft: EmployeeDraft;
  set: <K extends keyof EmployeeDraft>(key: K, value: EmployeeDraft[K]) => void;
  errors?: FormErrors;
  onBlurField?: (key: keyof FormErrors) => void;
}) {
  return (
    <div className="ee-team-step">
      <h3 className="ee-team-step-title">Personal information</h3>
      <div className="ee-team-photo">
        <button type="button" className="ee-team-photo-btn" aria-label="Upload photo">
          <Camera size={22} strokeWidth={1.5} />
          <span>Upload photo</span>
        </button>
      </div>

      <div className="ee-cust-grid ee-cust-grid-2">
        <Field label="First name" required error={errors.firstName}>
          <input
            className="input"
            value={draft.firstName}
            onChange={(e) => set("firstName", e.target.value)}
            onBlur={() => onBlurField?.("firstName")}
            placeholder="First name"
          />
        </Field>
        <Field label="Last name" required error={errors.lastName}>
          <input
            className="input"
            value={draft.lastName}
            onChange={(e) => set("lastName", e.target.value)}
            onBlur={() => onBlurField?.("lastName")}
            placeholder="Last name"
          />
        </Field>
        <Field label="Middle name">
          <input className="input" value={draft.middleName} onChange={(e) => set("middleName", e.target.value)} placeholder="Middle name" />
        </Field>
        <Field label="Preferred name">
          <input className="input" value={draft.preferredName} onChange={(e) => set("preferredName", e.target.value)} placeholder="Preferred name" />
        </Field>
        <Field label="Date of birth">
          <input className="input" type="date" value={draft.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} />
        </Field>
        <Field label="Gender">
          <Select
            value={draft.gender}
            onChange={(v) => set("gender", v)}
            searchable={false}
            options={GENDER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            placeholder="Select gender"
            aria-label="Gender"
          />
        </Field>
        <Field label="National ID / Passport number" className="span-2">
          <input className="input" value={draft.nationalId} onChange={(e) => set("nationalId", e.target.value)} placeholder="Enter ID or passport number" />
        </Field>
      </div>

      <h3 className="ee-team-step-title ee-team-step-title-spaced">Contact details</h3>
      <div className="ee-cust-grid ee-cust-grid-2">
        <Field label="Email address" className="span-2" error={errors.email}>
          <input
            className="input"
            type="email"
            value={draft.email}
            onChange={(e) => set("email", e.target.value)}
            onBlur={() => onBlurField?.("email")}
            placeholder="name@company.com"
          />
        </Field>
        <Field label="Phone number" className="span-2">
          <input className="input" value={draft.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+250" />
        </Field>
        <Field label="Residential address" className="span-2">
          <input className="input" value={draft.address} onChange={(e) => set("address", e.target.value)} placeholder="Street address" />
        </Field>
        <Field label="City / District">
          <input className="input" value={draft.city} onChange={(e) => set("city", e.target.value)} placeholder="City or district" />
        </Field>
        <Field label="Country">
          <Select
            value={draft.country}
            onChange={(v) => set("country", v)}
            searchable
            options={COUNTRY_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            aria-label="Country"
          />
        </Field>
      </div>
    </div>
  );
}
