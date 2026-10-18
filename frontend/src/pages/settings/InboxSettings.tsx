import { CalendarDays, Pencil } from "lucide-react";
import { useState } from "react";
import { SettingsLayout } from "../../components/settings/SettingsLayout";
import { SettingsToggle } from "../../components/settings/SettingsToggle";
import { INBOX_SETTINGS } from "../../lib/settings-dummy";

export function InboxSettings() {
  const [alerts, setAlerts] = useState(INBOX_SETTINGS.companyAlerts);
  const [ai, setAi] = useState(INBOX_SETTINGS.aiFollowUp);

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
              Connect an email account to send and receive messages
            </div>
          </div>
          <button type="button" className="btn btn-primary">
            Connect email account
          </button>
        </div>
      </section>

      <section className="ee-settings-card">
        <header className="ee-settings-card-head ee-settings-card-head-row">
          <div>
            <h2>Messages</h2>
            <p>Control team alerts and automatic follow-up.</p>
          </div>
          <button type="button" className="ee-link-btn">
            <Pencil size={14} strokeWidth={1.5} aria-hidden="true" /> Edit
          </button>
        </header>

        <div className="ee-settings-row ee-settings-row-top">
          <div>
            <div className="ee-settings-row-label">Company alerts</div>
            <div className="ee-settings-hint" style={{ marginTop: 4 }}>
              Assigned team members receive reminders to reply to new messages.
            </div>
            <div className="ee-settings-schedule">
              <CalendarDays size={14} strokeWidth={1.5} aria-hidden="true" />
              {INBOX_SETTINGS.companyAlertsSchedule}
            </div>
          </div>
          <SettingsToggle label="Company alerts" on={alerts} onChange={setAlerts} />
        </div>

        <div className="ee-settings-row ee-settings-row-top">
          <div>
            <div className="ee-settings-row-label">AI follow-up</div>
            <div className="ee-settings-hint" style={{ marginTop: 4 }}>
              Excel Edge AI requests more details when replies to accountants or team members are incomplete.
              Applies only to messages sent by accountants and team members.
            </div>
          </div>
          <SettingsToggle label="AI follow-up" on={ai} onChange={setAi} />
        </div>
      </section>
    </SettingsLayout>
  );
}
