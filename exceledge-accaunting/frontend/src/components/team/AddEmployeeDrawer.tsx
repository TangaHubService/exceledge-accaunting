import { Check } from "lucide-react";
import { type FormEvent, useState } from "react";
import {
  clearEmployeeDraft,
  type EmployeeDraft,
  employeeDisplayName,
  type EmployeeStepId,
  EMPLOYEE_STEPS,
  emptyEmployeeDraft,
  loadEmployeeDraft,
  saveEmployeeDraft,
  type StoredEmployee,
} from "../../lib/team-dummy";
import { employeeEmploymentSchema, employeePersonalSchema, validateYup } from "../../lib/validation";
import { useFeedback } from "../feedback";
import { Drawer } from "../ui";
import { EmployeeDocumentsStep } from "./EmployeeDocumentsStep";
import { EmployeeEmploymentStep } from "./EmployeeEmploymentStep";
import { EmployeePayrollStep } from "./EmployeePayrollStep";
import { EmployeePersonalStep } from "./EmployeePersonalStep";

export function AddEmployeeDrawer({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (employee: StoredEmployee) => void;
}) {
  const { toast } = useFeedback();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<EmployeeDraft>(() => loadEmployeeDraft() ?? emptyEmployeeDraft());
  const [personalErrors, setPersonalErrors] = useState<Record<string, string>>({});
  const [employmentErrors, setEmploymentErrors] = useState<Record<string, string>>({});

  function set<K extends keyof EmployeeDraft>(key: K, value: EmployeeDraft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function saveDraft() {
    saveEmployeeDraft(draft);
    toast("Draft saved");
  }

  function goBack() {
    setStep((s) => Math.max(0, s - 1));
  }

  async function goNext(e?: FormEvent) {
    e?.preventDefault();
    if (step === 0) {
      const result = await validateYup(employeePersonalSchema, draft);
      if (!result.ok) {
        setPersonalErrors((result.errors as Record<string, string>) || {});
        return;
      }
      setPersonalErrors({});
    }
    if (step === 1) {
      const result = await validateYup(employeeEmploymentSchema, draft);
      if (!result.ok) {
        setEmploymentErrors((result.errors as Record<string, string>) || {});
        return;
      }
      setEmploymentErrors({});
    }
    if (step < EMPLOYEE_STEPS.length - 1) {
      setStep((s) => s + 1);
      return;
    }
    const employee: StoredEmployee = {
      ...draft,
      id: `emp-${Date.now()}`,
      displayName: employeeDisplayName(draft),
      createdAt: new Date().toISOString(),
    };
    clearEmployeeDraft();
    toast(`${employee.displayName} saved`);
    onSaved(employee);
  }

  const meta = EMPLOYEE_STEPS[step]!;
  const isLast = step === EMPLOYEE_STEPS.length - 1;

  return (
    <Drawer
      title="Add employee"
      subtitle="Create an employee record."
      wide
      onClose={onClose}
      footer={
        <div className="ee-team-drawer-foot">
          <button type="button" className="ee-link-btn" onClick={step === 0 ? onClose : goBack}>
            {step === 0 ? "Cancel" : "Back"}
          </button>
          <div className="ee-team-drawer-foot-right">
            <button type="button" className="btn ee-btn-outline-blue" onClick={saveDraft}>
              Save draft
            </button>
            <button type="submit" form="add-employee-form" className="btn btn-primary">
              {isLast ? (
                <>
                  <Check size={16} aria-hidden="true" />
                  Save employee
                </>
              ) : (
                <>
                  {meta.nextLabel}
                  <span aria-hidden="true"> →</span>
                </>
              )}
            </button>
            <span className="ee-team-step-count">
              {step + 1} of {EMPLOYEE_STEPS.length}
            </span>
          </div>
        </div>
      }
    >
      <form id="add-employee-form" className="ee-add-employee" onSubmit={(e) => void goNext(e)} noValidate>
        <ol className="ee-team-stepper" aria-label="Employee steps">
          {EMPLOYEE_STEPS.map((s, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <li key={s.id} className={`ee-team-stepper-item ${done ? "done" : ""} ${active ? "active" : ""}`}>
                <span className="ee-team-stepper-dot" aria-hidden="true">
                  {done ? <Check size={12} strokeWidth={2.5} /> : i + 1}
                </span>
                <span className="ee-team-stepper-label">{s.label}</span>
              </li>
            );
          })}
        </ol>

        {meta.id === ("personal" satisfies EmployeeStepId) && (
          <EmployeePersonalStep
            draft={draft}
            set={set}
            errors={{
              firstName: personalErrors.firstName,
              lastName: personalErrors.lastName,
              email: personalErrors.email,
            }}
            onBlurField={async (key) => {
              const result = await validateYup(employeePersonalSchema, draft);
              setPersonalErrors((prev) => ({ ...prev, [key]: result.ok ? undefined : result.errors[key] }) as Record<string, string>);
            }}
          />
        )}
        {meta.id === "employment" && (
          <EmployeeEmploymentStep
            draft={draft}
            set={set}
            errors={{ joiningDate: employmentErrors.joiningDate }}
            onBlurField={async (key) => {
              const result = await validateYup(employeeEmploymentSchema, draft);
              setEmploymentErrors((prev) => ({ ...prev, [key]: result.ok ? undefined : result.errors[key] }) as Record<string, string>);
            }}
          />
        )}
        {meta.id === "payroll" && <EmployeePayrollStep draft={draft} set={set} />}
        {meta.id === "documents" && <EmployeeDocumentsStep />}
      </form>
    </Drawer>
  );
}
