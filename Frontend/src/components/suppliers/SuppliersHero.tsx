import { SUPPLIER_HERO } from "../../lib/supplier-hub-dummy";
import { SuppliersIllustration } from "./SuppliersIllustration";

export function SuppliersHero({ onAdd, onImport }: { onAdd: () => void; onImport: () => void }) {
  return (
    <section className="ee-cust-hero ee-sup-hero" aria-label="Suppliers empty state">
      <div className="ee-cust-hero-copy">
        <h2>{SUPPLIER_HERO.title}</h2>
        <ul className="ee-cust-bullets">
          {SUPPLIER_HERO.bullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
        <div className="ee-cust-hero-actions">
          <button type="button" className="btn btn-primary" onClick={onImport}>
            Import suppliers
          </button>
          <button type="button" className="btn ee-btn-outline-blue" onClick={onAdd}>
            Add supplier
          </button>
        </div>
      </div>
      <div className="ee-cust-hero-art">
        <SuppliersIllustration />
      </div>
    </section>
  );
}
