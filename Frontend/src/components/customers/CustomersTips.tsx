import { Link } from "../../lib/router";
import { CUSTOMER_HERO, LEADS_HERO } from "../../lib/customer-hub-dummy";

export function CustomersTips({ mode }: { mode: "customers" | "leads" }) {
  const tips = mode === "customers" ? CUSTOMER_HERO.tips : LEADS_HERO.tips;

  return (
    <section className="ee-cust-tips" aria-label="Tips and resources">
      <h3>Tips &amp; resources</h3>
      <ul>
        {tips.map((t) => (
          <li key={t.label}>
            {t.href.startsWith("/") ? (
              <Link to={t.href}>{t.label}</Link>
            ) : (
              <a href={t.href} onClick={(e) => e.preventDefault()}>
                {t.label}
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
