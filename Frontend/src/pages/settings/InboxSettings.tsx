import { SettingsLayout } from "../../components/settings/SettingsLayout";
import { SettingsSection } from "../../components/settings/SettingsSection";

export function InboxSettings() {
  return (
    <SettingsLayout title="Inbox" subtitle="Manage connected email accounts and messaging preferences.">
      <section className="ee-settings-card">
        <header className="ee-settings-card-head">
          <h2>Channels</h2>
          <p>Bring your business conversations into one place.</p>
        </header>
        <div className="ee-settings-row ee-settings-row-stack">
          <div>
            <div className="ee-settings-row-label">Email connections</div>
            <div className="ee-settings-hint" style={{ marginTop: 4 }}>
              Receiving email needs a mail provider, which isn't connected yet.
            </div>
          </div>
          <button type="button" className="btn btn-primary" disabled>
            Connect email account
          </button>
        </div>
      </section>
        <SettingsSection id="inbox-messages" title="Messages" description="Control team alerts and automatic follow-up." rows={[
          { key: "alerts", label: "Company alerts", kind: "toggle", value: true, hint: "Assigned team members receive reminders to reply to new messages.", soon: true },
          { key: "schedule", label: "Alert day", kind: "select", value: "Every Monday", options: ["Every day", "Every Monday", "Every Friday"], soon: true },
          { key: "ai", label: "AI follow-up", kind: "toggle", value: true, hint: "Asks for more details when replies to accountants or team members are incomplete.", soon: true },
        ]} />
    </SettingsLayout>
  );
}
