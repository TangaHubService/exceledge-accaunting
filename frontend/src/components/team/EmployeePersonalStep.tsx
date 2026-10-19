import { Camera } from "lucide-react";
import { COUNTRY_OPTIONS, type EmployeeDraft, GENDER_OPTIONS } from "../../lib/team-dummy";

export function EmployeePersonalStep({
  draft,
  set,
}: {
  draft: EmployeeDraft;
  set: <K extends keyof EmployeeDraft>(key: K, value: EmployeeDraft[K]) => void;
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
        <label className="field">
          <span>
            First name <span className="req">*</span>
          </span>
          <input className="input" value={draft.firstName} onChange={(e) => set("firstName", e.target.value)} placeholder="First name" required />
        </label>
        <label className="field">
          <span>
            Last name <span className="req">*</span>
          </span>
          <input className="input" value={draft.lastName} onChange={(e) => set("lastName", e.target.value)} placeholder="Last name" required />
        </label>
        <label className="field">
          <span>Middle name</span>
          <input className="input" value={draft.middleName} onChange={(e) => set("middleName", e.target.value)} placeholder="Middle name" />
        </label>
        <label className="field">
          <span>Preferred name</span>
          <input className="input" value={draft.preferredName} onChange={(e) => set("preferredName", e.target.value)} placeholder="Preferred name" />
        </label>
        <label className="field">
          <span>Date of birth</span>
          <input className="input" type="date" value={draft.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} />
        </label>
        <label className="field">
          <span>Gender</span>
          <select className="input" value={draft.gender} onChange={(e) => set("gender", e.target.value)}>
            {GENDER_OPTIONS.map((o) => (
              <option key={o.value || "g"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field span-2">
          <span>National ID / Passport number</span>
          <input className="input" value={draft.nationalId} onChange={(e) => set("nationalId", e.target.value)} placeholder="Enter ID or passport number" />
        </label>
      </div>

      <h3 className="ee-team-step-title ee-team-step-title-spaced">Contact details</h3>
      <div className="ee-cust-grid ee-cust-grid-2">
        <label className="field span-2">
          <span>Email address</span>
          <input className="input" type="email" value={draft.email} onChange={(e) => set("email", e.target.value)} placeholder="name@company.com" />
        </label>
        <label className="field span-2">
          <span>Phone number</span>
          <input className="input" value={draft.phone} onChange={(e) => set("phone", e.target.value)} placeholder="+250" />
        </label>
        <label className="field span-2">
          <span>Residential address</span>
          <input className="input" value={draft.address} onChange={(e) => set("address", e.target.value)} placeholder="Street address" />
        </label>
        <label className="field">
          <span>City / District</span>
          <input className="input" value={draft.city} onChange={(e) => set("city", e.target.value)} placeholder="City or district" />
        </label>
        <label className="field">
          <span>Country</span>
          <select className="input" value={draft.country} onChange={(e) => set("country", e.target.value)}>
            {COUNTRY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
