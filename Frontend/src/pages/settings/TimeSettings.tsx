import { SettingsLayout } from "../../components/settings/SettingsLayout";
import { SettingsSection } from "../../components/settings/SettingsSection";

export function TimeSettings() {
  return (
    <SettingsLayout title="Time" subtitle="Manage your work week and timesheet preferences.">
        <SettingsSection id="time-general" title="General" description="Set the starting day for your weekly time records." rows={[
          { key: "firstDay", label: "First day of work week", kind: "select", value: "Sunday", options: ["Sunday", "Monday", "Saturday"] },
        ]} />
        <SettingsSection id="time-sheet" title="Timesheet" description="Choose the fields and billing options available on timesheets." rows={[
          { key: "service", label: "Show service field", kind: "toggle", value: true },
          { key: "billable", label: "Allow time to be billable", kind: "toggle", value: true },
        ]} />
    </SettingsLayout>
  );
}
