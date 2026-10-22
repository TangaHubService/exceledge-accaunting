import { useState } from "react";
import { useFeedback } from "../../components/feedback";
import { SettingsEditButton } from "../../components/settings/SettingsEditButton";
import { SettingsLayout } from "../../components/settings/SettingsLayout";
import { SettingsToggle } from "../../components/settings/SettingsToggle";
import { EXPENSES_SETTINGS } from "../../lib/settings-dummy";

export function ExpensesSettings() {
  const { toast } = useFeedback();
  const [bills, setBills] = useState(() =>
    Object.fromEntries(EXPENSES_SETTINGS.bills.map((r) => [r.label, r.value])),
  );
  const [usePo, setUsePo] = useState(EXPENSES_SETTINGS.purchaseOrders);

  return (
    <SettingsLayout title="Expenses" subtitle="Manage bills, purchasing and supplier communication.">
      <section className="ee-settings-card">
        <header className="ee-settings-card-head ee-settings-card-head-row">
          <div>
            <h2>Bills and expenses</h2>
          </div>
          <SettingsEditButton section="Bills and expenses" />
        </header>
        <ul className="ee-settings-pref-list">
          {EXPENSES_SETTINGS.bills.map((row) => (
            <li key={row.label}>
              <span>{row.label}</span>
              {row.kind === "toggle" ? (
                <SettingsToggle
                  label={row.label}
                  on={Boolean(bills[row.label])}
                  onChange={(v) => setBills((f) => ({ ...f, [row.label]: v }))}
                />
              ) : (
                <strong>{String(bills[row.label] ?? row.value)}</strong>
              )}
            </li>
          ))}
        </ul>
      </section>

      <div className="ee-settings-grid-2">
        <section className="ee-settings-card">
          <header className="ee-settings-card-head ee-settings-card-head-row">
            <h2>Purchase orders</h2>
            <SettingsEditButton section="Purchase orders" />
          </header>
          <div className="ee-settings-row">
            <div className="ee-settings-row-label">Use purchase orders</div>
            <SettingsToggle label="Use purchase orders" on={usePo} onChange={setUsePo} />
          </div>
        </section>

        <section className="ee-settings-card">
          <header className="ee-settings-card-head ee-settings-card-head-row">
            <h2>Messages</h2>
            <SettingsEditButton section="Messages" />
          </header>
          <div className="ee-settings-row">
            <div className="ee-settings-row-label">Default email message sent with purchase orders and bills</div>
            <button type="button" className="ee-link-btn" onClick={() => toast("Customise purchase email message")}>
              {EXPENSES_SETTINGS.messages.customise}
            </button>
          </div>
        </section>
      </div>
    </SettingsLayout>
  );
}
