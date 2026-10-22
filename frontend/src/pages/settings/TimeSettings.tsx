import { SettingsEditButton } from "../../components/settings/SettingsEditButton";
import { SettingsLayout } from "../../components/settings/SettingsLayout";
import { TIME_SETTINGS } from "../../lib/settings-dummy";

function OnBadge() {
  return <span className="ee-settings-on-badge">On</span>;
}

export function TimeSettings() {
  return (
    <SettingsLayout title="Time" subtitle="Manage your work week and timesheet preferences.">
      <section className="ee-settings-card">
        <header className="ee-settings-card-head ee-settings-card-head-row">
          <div>
            <h2>General</h2>
            <p>Set the starting day for your weekly time records.</p>
          </div>
          <SettingsEditButton section="General" />
        </header>
        <div className="ee-settings-row">
          <div className="ee-settings-row-label">First day of work week</div>
          <strong>{TIME_SETTINGS.firstDayOfWeek}</strong>
        </div>
      </section>

      <section className="ee-settings-card">
        <header className="ee-settings-card-head ee-settings-card-head-row">
          <div>
            <h2>Timesheet</h2>
            <p>Choose the fields and billing options available on timesheets.</p>
          </div>
          <SettingsEditButton section="Timesheet" />
        </header>
        <div className="ee-settings-row">
          <div className="ee-settings-row-label">Show service field</div>
          {TIME_SETTINGS.showServiceField ? <OnBadge /> : <span className="ee-settings-off-badge">Off</span>}
        </div>
        <div className="ee-settings-row">
          <div className="ee-settings-row-label">Allow time to be billable</div>
          {TIME_SETTINGS.allowBillable ? <OnBadge /> : <span className="ee-settings-off-badge">Off</span>}
        </div>
      </section>
    </SettingsLayout>
  );
}
