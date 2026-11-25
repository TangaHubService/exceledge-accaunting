import { SettingsLayout } from "../../components/settings/SettingsLayout";
import { SettingsSection } from "../../components/settings/SettingsSection";
import { SettingsToggle } from "../../components/settings/SettingsToggle";
import { useFeedback } from "../../components/feedback";
import { useCoaSettings } from "../../lib/coa-settings";
import { useCompany } from "../../lib/company";
import { Link } from "../../lib/router";
import { useResource } from "../../lib/session";

function Fact({ label, value, to = "/setup" }: { label: string; value: string; to?: string }) {
  return (
    <div className="ee-settings-row">
      <div>
        <div className="ee-settings-row-label">{label}</div>
        <div className="ee-settings-row-value">{value}</div>
      </div>
      <Link to={to} className="ee-link-btn">Change</Link>
    </div>
  );
}

type Snapshot = { businessInfo: { accountingBasis?: string } | null };

export function AdvancedSettings() {
  const company = useCompany();
  const info = useResource<Snapshot>("/api/v1/setup/snapshot").data?.businessInfo;
  const coa = useCoaSettings();
  const { toast } = useFeedback();
  const year = company.snapshot?.years.find((y) => y.isCurrent) ?? company.snapshot?.years[0];
  const basis = info?.accountingBasis ?? "";
  async function setNumbers(on: boolean) {
    try {
      await coa.setUseAccountNumbers(on);
      toast(on ? "Account numbers turned on" : "Account numbers turned off");
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  return (
    <SettingsLayout title="Advanced" subtitle="Manage accounting preferences and company configuration.">
      <section className="ee-settings-card">
        <header className="ee-settings-card-head"><h2>Accounting</h2><p>These control the books, so they are changed in company setup.</p></header>
        <Fact label="First month of financial year" value={year ? new Date(year.startDate).toLocaleDateString("en", { month: "long", timeZone: "UTC" }) : "Not set"} />
        <Fact label="Accounting method" value={basis ? basis.charAt(0) + basis.slice(1).toLowerCase().replace("_", " ") : "Not set"} />
        <Fact label="Close the books" value="Periods are closed one at a time" />
      </section>
      <section className="ee-settings-card">
        <header className="ee-settings-card-head"><h2>Chart of accounts</h2></header>
        <div className="ee-settings-row">
          <div className="ee-settings-row-label">Enable account numbers</div>
          <SettingsToggle label="Enable account numbers" on={coa.useAccountNumbers} disabled={!coa.loaded} onChange={(on) => void setNumbers(on)} />
        </div>
      </section>
        <SettingsSection id="adv-company" title="Company type" rows={[
          { key: "taxForm", label: "Tax form", kind: "select", value: "Not configured", options: ["Not configured", "Corporate income tax", "Personal income tax", "Not for profit"], hint: "Select the tax classification applicable to your business.", soon: true },
        ]} />
        <SettingsSection id="adv-comms" title="Communications with Excel Edge" rows={[
          { key: "marketing", label: "Receive product news by email", kind: "toggle", value: false, soon: true },
        ]} />
        <SettingsSection id="adv-categories" title="Categories" rows={[
          { key: "classes", label: "Track classes", kind: "toggle", value: false, soon: true },
          { key: "locations", label: "Track locations", kind: "toggle", value: false, soon: true },
        ]} />
        <SettingsSection id="adv-automation" title="Automation" rows={[
          { key: "prefill", label: "Pre-fill forms with previously entered content", kind: "toggle", value: true, soon: true },
          { key: "unbilled", label: "Automatically invoice unbilled activity", kind: "toggle", value: false, soon: true },
          { key: "autoPay", label: "Automatically apply bill payments", kind: "toggle", value: true, soon: true },
          { key: "recurring", label: "Recurring transactions", kind: "link", value: "Manage", to: "/accounting/recurring-transactions" },
          { key: "rules", label: "Bank rules", kind: "link", value: "Manage", to: "/banking/rules" },
        ]} />
        <SettingsSection id="adv-projects" title="Projects" rows={[
          { key: "projects", label: "Organise all job-related activity in one place", kind: "toggle", value: true, soon: true },
        ]} />
        <SettingsSection id="adv-language" title="Language" rows={[
          { key: "language", label: "Language", kind: "select", value: "English", options: ["English", "Kinyarwanda", "French"], soon: true },
        ]} />
      <section className="ee-settings-card">
        <header className="ee-settings-card-head"><h2>Currency</h2></header>
        <Fact label="Home currency" value={company.currency} />
      </section>
        <SettingsSection id="adv-other" title="Other preferences" rows={[
          { key: "dateFormat", label: "Date format", kind: "select", value: "dd/mm/yyyy", options: ["dd/mm/yyyy", "mm/dd/yyyy", "yyyy-mm-dd"], soon: true },
          { key: "cheque", label: "Warn me if duplicate cheque number is used", kind: "toggle", value: true, soon: true },
          { key: "journal", label: "Warn me if duplicate journal number is used", kind: "toggle", value: false, soon: true },
          { key: "inactive", label: "Notify me if inactive for", kind: "select", value: "1 hour", options: ["30 minutes", "1 hour", "3 hours"], soon: true },
        ]} />
    </SettingsLayout>
  );
}
