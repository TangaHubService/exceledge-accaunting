import { Pencil } from "lucide-react";
import { useState } from "react";
import { SettingsLayout } from "../../components/settings/SettingsLayout";
import { SettingsToggle } from "../../components/settings/SettingsToggle";
import { EXPENSES_SETTINGS } from "../../lib/settings-dummy";

export function ExpensesSettings() {
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
          <button type="button" className="ee-link-btn">
            <Pencil size={14} strokeWidth={1.5} aria-hidden="true" /> Edit
          </button>
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
            <button type="button" className="ee-link-btn">
              <Pencil size={14} strokeWidth={1.5} aria-hidden="true" /> Edit
            </button>
          </header>
          <div className="ee-settings-row">
            <div className="ee-settings-row-label">Use purchase orders</div>
            <SettingsToggle label="Use purchase orders" on={usePo} onChange={setUsePo} />
          </div>
        </section>

        <section className="ee-settings-card">
          <header className="ee-settings-card-head ee-settings-card-head-row">
            <h2>Messages</h2>
            <button type="button" className="ee-link-btn">
              <Pencil size={14} strokeWidth={1.5} aria-hidden="true" /> Edit
            </button>
          </header>
          <div className="ee-settings-row">
            <div className="ee-settings-row-label">Default email message sent with purchase orders and bills</div>
            <button type="button" className="ee-link-btn">
              {EXPENSES_SETTINGS.messages.customise}
            </button>
          </div>
        </section>
      </div>
    </SettingsLayout>
  );
}
