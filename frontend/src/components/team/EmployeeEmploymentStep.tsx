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

export function EmployeeEmploymentStep({
  draft,
  set,
}: {
  draft: EmployeeDraft;
  set: <K extends keyof EmployeeDraft>(key: K, value: EmployeeDraft[K]) => void;
}) {
  return (
    <div className="ee-team-step">
      <h3 className="ee-team-step-title">Employment details</h3>
      <div className="ee-cust-grid ee-cust-grid-2">
        <label className="field">
          <span>Employee ID</span>
          <input className="input" value={draft.employeeId} readOnly />
        </label>
        <label className="field">
          <span>Job title</span>
          <input className="input" value={draft.jobTitle} onChange={(e) => set("jobTitle", e.target.value)} placeholder="Enter job title" />
        </label>
        <label className="field">
          <span>Department</span>
          <select className="input" value={draft.department} onChange={(e) => set("department", e.target.value)}>
            {DEPARTMENT_OPTIONS.map((o) => (
              <option key={o.value || "d"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Employment type</span>
          <select className="input" value={draft.employmentType} onChange={(e) => set("employmentType", e.target.value)}>
            {EMPLOYMENT_TYPE_OPTIONS.map((o) => (
              <option key={o.value || "t"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field span-2">
          <span>
            Joining date <span className="req">*</span>
          </span>
          <input className="input" type="date" value={draft.joiningDate} onChange={(e) => set("joiningDate", e.target.value)} required />
          <span className="ee-field-hint">The date the employee starts working with your organisation.</span>
        </label>
        <label className="field">
          <span>Work location</span>
          <select className="input" value={draft.workLocation} onChange={(e) => set("workLocation", e.target.value)}>
            {WORK_LOCATION_OPTIONS.map((o) => (
              <option key={o.value || "l"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Reporting manager</span>
          <select className="input" value={draft.reportingManager} onChange={(e) => set("reportingManager", e.target.value)}>
            {MANAGER_OPTIONS.map((o) => (
              <option key={o.value || "m"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field span-2">
          <span>Employment status</span>
          <select className="input" value={draft.employmentStatus} onChange={(e) => set("employmentStatus", e.target.value)}>
            {EMPLOYMENT_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <h3 className="ee-team-step-title ee-team-step-title-spaced">Contract details</h3>
      <div className="ee-cust-grid ee-cust-grid-2">
        <label className="field">
          <span>Contract start date</span>
          <input className="input" type="date" value={draft.contractStart} onChange={(e) => set("contractStart", e.target.value)} />
        </label>
        <label className="field">
          <span>Contract end date (optional)</span>
          <input className="input" type="date" value={draft.contractEnd} onChange={(e) => set("contractEnd", e.target.value)} />
        </label>
        <label className="field">
          <span>Probation period</span>
          <select className="input" value={draft.probation} onChange={(e) => set("probation", e.target.value)}>
            {PROBATION_OPTIONS.map((o) => (
              <option key={o.value || "p"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Work schedule</span>
          <select className="input" value={draft.workSchedule} onChange={(e) => set("workSchedule", e.target.value)}>
            {WORK_SCHEDULE_OPTIONS.map((o) => (
              <option key={o.value || "s"} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
