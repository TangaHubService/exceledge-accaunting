import {
  DEPARTMENT_OPTIONS,
  type EmployeeDraft,
  EMPLOYMENT_STATUS_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  MANAGER_OPTIONS,
  PROBATION_OPTIONS,
  WORK_LOCATION_OPTIONS,
  WORK_SCHEDULE_OPTIONS,
} from "../../lib/team-dummy";
import { Select } from "../Select";
import { Field } from "../ui";

type FormErrors = {
  joiningDate?: string;
};

export function EmployeeEmploymentStep({
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
      <h3 className="ee-team-step-title">Employment details</h3>
      <div className="ee-cust-grid ee-cust-grid-2">
        <Field label="Employee ID">
          <input className="input" value={draft.employeeId} readOnly />
        </Field>
        <Field label="Job title">
          <input className="input" value={draft.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} placeholder="Enter job title" />
        </Field>
        <Field label="Department">
          <Select
            value={draft.department}
            onChange={(v) => set("department", v)}
            searchable={false}
            options={DEPARTMENT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            placeholder="Select department"
            aria-label="Department"
          />
        </Field>
        <Field label="Employment type">
          <Select
            value={draft.employmentType}
            onChange={(v) => set("employmentType", v)}
            searchable={false}
            options={EMPLOYMENT_TYPE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            placeholder="Select type"
            aria-label="Employment type"
          />
        </Field>
        <Field
          label="Joining date"
          required
          className="span-2"
          error={errors.joiningDate}
          hint={!errors.joiningDate ? "The date the employee starts working with your organisation." : undefined}
        >
          <input
            className="input"
            type="date"
            value={draft.joiningDate}
            onChange={(e) => set("joiningDate", e.target.value)}
            onBlur={() => onBlurField?.("joiningDate")}
          />
        </Field>
        <Field label="Work location">
          <Select
            value={draft.workLocation}
            onChange={(v) => set("workLocation", v)}
            searchable={false}
            options={WORK_LOCATION_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            placeholder="Select location"
            aria-label="Work location"
          />
        </Field>
        <Field label="Reporting manager">
          <Select
            value={draft.reportingManager}
            onChange={(v) => set("reportingManager", v)}
            searchable
            options={MANAGER_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            placeholder="Select manager"
            aria-label="Reporting manager"
          />
        </Field>
        <Field label="Employment status" className="span-2">
          <Select
            value={draft.employmentStatus}
            onChange={(v) => set("employmentStatus", v)}
            searchable={false}
            options={EMPLOYMENT_STATUS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            aria-label="Employment status"
          />
        </Field>
      </div>

      <h3 className="ee-team-step-title ee-team-step-title-spaced">Contract details</h3>
      <div className="ee-cust-grid ee-cust-grid-2">
        <Field label="Contract start date">
          <input className="input" type="date" value={draft.contractStart} onChange={(e) => set("contractStart", e.target.value)} />
        </Field>
        <Field label="Contract end date (optional)">
          <input className="input" type="date" value={draft.contractEnd} onChange={(e) => set("contractEnd", e.target.value)} />
        </Field>
        <Field label="Probation period">
          <Select
            value={draft.probation}
            onChange={(v) => set("probation", v)}
            searchable={false}
            options={PROBATION_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            placeholder="Select period"
            aria-label="Probation period"
          />
        </Field>
        <Field label="Work schedule">
          <Select
            value={draft.workSchedule}
            onChange={(v) => set("workSchedule", v)}
            searchable={false}
            options={WORK_SCHEDULE_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            placeholder="Select schedule"
            aria-label="Work schedule"
          />
        </Field>
      </div>
    </div>
  );
}
