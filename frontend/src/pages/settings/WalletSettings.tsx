import { Building2, MoreVertical, Plus, Wallet } from "lucide-react";
import { SettingsLayout } from "../../components/settings/SettingsLayout";
import { WALLET_SETTINGS } from "../../lib/settings-dummy";

export function WalletSettings() {
  const cards = WALLET_SETTINGS.cards;

  return (
    <SettingsLayout title="Wallet" subtitle="Manage payment methods used for your ERP subscription.">
      <section className="ee-settings-card">
        <header className="ee-settings-card-head ee-settings-card-head-row">
          <h2>Bank accounts</h2>
          <button type="button" className="btn ee-btn-outline-blue btn-sm">
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
          <button type="button" className="btn ee-btn-outline-blue btn-sm">
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
            <tbody>
              {cards.map((card) => (
                <tr key={card.last4}>
                  <td>
                    <span className="ee-settings-card-brand">{card.brand}</span>
                    <span>
                      {card.brand} (•••• {card.last4})
                    </span>
                  </td>
                  <td>
                    <span className="ee-settings-used-for">{card.usedFor}</span>
                  </td>
                  <td>
                    <button type="button" className="ee-icon-btn" aria-label="Card actions">
                      <MoreVertical size={16} strokeWidth={1.5} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="ee-settings-table-foot">
            <span>
              1–{cards.length} of {cards.length} items
            </span>
            <span>Page 1 of 1</span>
          </div>
        </div>
      </section>
    </SettingsLayout>
  );
}
