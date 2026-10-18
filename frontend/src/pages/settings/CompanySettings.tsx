import { Pencil, Store } from "lucide-react";
import { useFeedback } from "../../components/feedback";
import { SettingsLayout } from "../../components/settings/SettingsLayout";
import { COMPANY_INFO } from "../../lib/settings-dummy";

function Row({ label, value }: { label: string; value: string }) {
  const { toast } = useFeedback();
  return (
    <div className="ee-settings-row">
      <div>
        <div className="ee-settings-row-label">{label}</div>
        <div className="ee-settings-row-value">{value}</div>
      </div>
      <button type="button" className="ee-link-btn" onClick={() => toast(`Edit ${label}`)}>
        Edit
      </button>
    </div>
  );
}

export function CompanySettings() {
  const { toast } = useFeedback();
  return (
    <SettingsLayout title="Company" subtitle="Manage your business profile and legal information.">
      <div className="ee-settings-profile">
        <button
          type="button"
          className="ee-settings-profile-avatar"
          aria-label="Edit company profile"
          onClick={() => toast("Edit company profile")}
        >
          <Store size={28} strokeWidth={1.5} />
          <span className="ee-settings-profile-edit">
            <Pencil size={12} strokeWidth={2} />
          </span>
        </button>
        <div className="ee-settings-profile-label">Company profile</div>
      </div>

      <section className="ee-settings-card ee-settings-card-flat">
        <div className="ee-settings-row">
          <div>
            <div className="ee-settings-row-label">Industry</div>
            <div className="ee-settings-row-value">{COMPANY_INFO.industry}</div>
          </div>
          <button type="button" className="ee-link-btn" onClick={() => toast("Edit Industry")}>
            Edit
          </button>
        </div>
      </section>

      <section className="ee-settings-card">
        <header className="ee-settings-card-head">
          <h2>Company info</h2>
          <p>Details customers and suppliers see on documents.</p>
        </header>
        <Row label="Name" value={COMPANY_INFO.name} />
        <Row label="Address" value={COMPANY_INFO.address} />
        <Row label="Email" value={COMPANY_INFO.email} />
      </section>

      <section className="ee-settings-card">
        <header className="ee-settings-card-head">
          <h2>Legal info</h2>
          <p>This is the information your business uses for tax purposes.</p>
        </header>
        <Row label="Legal business name" value={COMPANY_INFO.legalName} />
        <Row label="VAT/GST/TAX ID number" value={COMPANY_INFO.tin} />
        <Row label="Business type" value={COMPANY_INFO.businessType} />
        <Row label="Legal address" value={COMPANY_INFO.legalAddress} />
      </section>

      <section className="ee-settings-card">
        <header className="ee-settings-card-head">
          <h2>Customer contact info</h2>
        </header>
        <Row label="Customer email" value={COMPANY_INFO.customerEmail} />
        <Row label="Customer address" value={COMPANY_INFO.customerAddress} />
      </section>
    </SettingsLayout>
  );
}
