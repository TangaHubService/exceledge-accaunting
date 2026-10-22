import { Download, FileText, Lightbulb } from "lucide-react";
import { EMPLOYEE_HERO } from "../../lib/team-dummy";

export function EmployeesTips() {
  const icons = [FileText, Download];

  return (
    <section className="ee-team-tips" aria-label="Tips and resources">
      <div className="ee-team-tips-intro">
        <span className="ee-team-tips-icon" aria-hidden="true">
          <Lightbulb size={18} strokeWidth={1.5} />
        </span>
        <div>
          <h3>Tips &amp; resources</h3>
          <p>Get started with helpful guides and templates.</p>
        </div>
      </div>
      <ul>
        {EMPLOYEE_HERO.tips.map((t, i) => {
          const Icon = icons[i] ?? FileText;
          return (
            <li key={t.label}>
              <a
                href={t.href}
                className="ee-team-tip-link"
                onClick={(e) => {
                  e.preventDefault();
                }}
              >
                <Icon size={15} strokeWidth={1.5} aria-hidden="true" />
                {t.label}
                <span aria-hidden="true">›</span>
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
