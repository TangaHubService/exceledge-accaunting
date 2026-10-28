import { Play } from "lucide-react";
import { CUSTOMER_HERO, LEADS_HERO } from "../../lib/customer-hub-dummy";
import { CustomersIllustration } from "./CustomersIllustration";

export function CustomersHero({
  mode,
  onAdd,
  onImport,
}: {
  mode: "customers" | "leads";
  onAdd: () => void;
  onImport?: () => void;
}) {
  const copy = mode === "customers" ? CUSTOMER_HERO : LEADS_HERO;

  return (
    <section className="ee-cust-hero" aria-label={mode === "customers" ? "Customers empty state" : "Leads empty state"}>
      <div className="ee-cust-hero-copy">
        <h2>{copy.title}</h2>
        <button type="button" className="ee-cust-video">
          <span className="ee-cust-video-play" aria-hidden="true">
            <Play size={12} fill="currentColor" strokeWidth={0} />
          </span>
          {copy.videoLabel}
        </button>
        <ul className="ee-cust-bullets">
          {copy.bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <div className="ee-cust-hero-actions">
          <button type="button" className="btn btn-primary" onClick={onImport}>
            {mode === "customers" ? "Import customers" : "Import leads"}
          </button>
          <button type="button" className="btn ee-btn-outline-blue" onClick={onAdd}>
            {mode === "customers" ? "Add customer" : "Add lead"}
          </button>
        </div>
      </div>
      <div className="ee-cust-hero-art">
        <CustomersIllustration />
      </div>
    </section>
  );
}
