import { Building2, CreditCard, Plus, Wallet } from "lucide-react";
import { SettingsLayout } from "../../components/settings/SettingsLayout";

export function WalletSettings() {
  return (
    <SettingsLayout title="Wallet" subtitle="Manage payment methods used for your ERP subscription.">
      <section className="ee-settings-card">
        <header className="ee-settings-card-head ee-settings-card-head-row">
          <h2>Bank accounts</h2>
          <button type="button" className="btn ee-btn-outline-blue btn-sm" disabled title="Needs a payment provider, which isn't connected yet">
            Add bank account
          </button>
        </header>
        <div className="ee-settings-table-wrap">
          <table className="ee-settings-table">
            <thead>
              <tr>
                <th>Bank account</th>
                <th>Used for</th>
                <th>Action</th>
              </tr>
            </thead>
          </table>
          <div className="ee-settings-empty">
            <div className="ee-settings-empty-art" aria-hidden="true">
              <Building2 size={36} strokeWidth={1.25} />
              <Wallet size={22} strokeWidth={1.5} className="ee-settings-empty-wallet" />
            </div>
            <p>No bank accounts are connected yet. Your connected bank accounts will appear here.</p>
          </div>
        </div>
      </section>

      <section className="ee-settings-card">
        <header className="ee-settings-card-head ee-settings-card-head-row">
          <h2>Cards</h2>
          <button type="button" className="btn ee-btn-outline-blue btn-sm" disabled title="Needs a payment provider, which isn't connected yet">
            <Plus size={14} strokeWidth={1.75} aria-hidden="true" /> Add card
          </button>
        </header>
        <div className="ee-settings-table-wrap">
          <table className="ee-settings-table">
            <thead>
              <tr>
                <th>Card</th>
                <th>Used for</th>
                <th>Action</th>
              </tr>
            </thead>
          </table>
          <div className="ee-settings-empty">
            <div className="ee-settings-empty-art" aria-hidden="true">
              <CreditCard size={36} strokeWidth={1.25} />
            </div>
            <p>No cards are saved yet. Adding one needs a payment provider, which isn't connected yet.</p>
          </div>
        </div>
      </section>
    </SettingsLayout>
  );
}
