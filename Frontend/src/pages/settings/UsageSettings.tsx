import { CircleHelp } from "lucide-react";
import { SettingsLayout } from "../../components/settings/SettingsLayout";
import { Link } from "../../lib/router";
import { USAGE_LIMITS } from "../../lib/settings-dummy";

export function UsageSettings() {
  const users = USAGE_LIMITS.billableUsers;
  const pct = Math.round((users.used / users.limit) * 100);

  return (
    <SettingsLayout title="Usage limits" subtitle="Monitor your users and accounts as your business grows.">
      <section className="ee-settings-card">
        <header className="ee-settings-usage-head">
          <h2>
            Billable users
            <CircleHelp size={14} strokeWidth={1.5} aria-hidden="true" />
          </h2>
          <strong>
            {users.used} of {users.limit}
          </strong>
        </header>
        <div className="ee-settings-progress" aria-hidden="true">
          <span style={{ width: `${pct}%` }} />
        </div>
        <Link to="/settings/company" className="ee-link-btn">
          Manage {users.used} users
        </Link>
        <p className="ee-settings-hint">Your plan includes up to {users.limit} billable users.</p>
      </section>

      <section className="ee-settings-card">
        <header className="ee-settings-usage-head">
          <h2>
            Chart of accounts
            <CircleHelp size={14} strokeWidth={1.5} aria-hidden="true" />
          </h2>
          <div className="ee-settings-usage-meta">
            <strong>{USAGE_LIMITS.chartOfAccounts.count} accounts</strong>
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
