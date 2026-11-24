import { CircleHelp } from "lucide-react";
import { SettingsLayout } from "../../components/settings/SettingsLayout";
import { Link } from "../../lib/router";
import { useCompany } from "../../lib/company";

export function UsageSettings() {
  const { accounts, loading } = useCompany();

  return (
    <SettingsLayout title="Usage limits" subtitle="Monitor your users and accounts as your business grows.">
      <section className="ee-settings-card">
        <header className="ee-settings-usage-head">
          <h2>
            Billable users
            <CircleHelp size={14} strokeWidth={1.5} aria-hidden="true" />
          </h2>
        </header>
        <Link to="/users" className="ee-link-btn">
          Manage users
        </Link>
        <p className="ee-settings-hint">Users and their billing are managed in Excel Edge ERP.</p>
      </section>

      <section className="ee-settings-card">
        <header className="ee-settings-usage-head">
          <h2>
            Chart of accounts
            <CircleHelp size={14} strokeWidth={1.5} aria-hidden="true" />
          </h2>
          <div className="ee-settings-usage-meta">
            <strong>{loading ? "…" : accounts.length} accounts</strong>
            <span className="ee-settings-pill">Unlimited</span>
          </div>
        </header>
        <Link to="/accounting/chart-of-accounts" className="ee-link-btn">
          View chart of accounts
        </Link>
        <p className="ee-settings-hint">Your plan includes unlimited accounts.</p>
      </section>
    </SettingsLayout>
  );
}
