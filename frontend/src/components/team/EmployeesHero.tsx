import { Plus, Upload } from "lucide-react";
import { EMPLOYEE_HERO } from "../../lib/team-dummy";
import { EmployeesIllustration } from "./EmployeesIllustration";

export function EmployeesHero({ onAdd, onImport }: { onAdd: () => void; onImport?: () => void }) {
  return (
    <section className="ee-team-hero" aria-label="Employees empty state">
      <div className="ee-team-hero-copy">
        <h2>{EMPLOYEE_HERO.title}</h2>
        <p className="ee-team-hero-sub">{EMPLOYEE_HERO.subtitle}</p>
        <ul className="ee-team-bullets">
          {EMPLOYEE_HERO.bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <div className="ee-team-hero-actions">
          <button type="button" className="btn btn-primary" onClick={onAdd}>
            <Plus size={16} aria-hidden="true" />
            Add employee
          </button>
          <button type="button" className="btn ee-btn-outline-blue" onClick={onImport ?? onAdd}>
            <Upload size={16} aria-hidden="true" />
            Import employees
          </button>
        </div>
      </div>
      <div className="ee-team-hero-art">
        <EmployeesIllustration />
      </div>
    </section>
  );
}
