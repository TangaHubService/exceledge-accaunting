import { Pencil } from "lucide-react";
import { useState, type Dispatch, type SetStateAction } from "react";
import { SettingsLayout } from "../../components/settings/SettingsLayout";
import { SettingsToggle } from "../../components/settings/SettingsToggle";
import { type PrefRow, SALES_SETTINGS } from "../../lib/settings-dummy";

function PrefList({
  rows,
  state,
  setState,
}: {
  rows: PrefRow[];
  state: Record<string, string | boolean>;
  setState: Dispatch<SetStateAction<Record<string, string | boolean>>>;
}) {
  return (
    <ul className="ee-settings-pref-list">
      {rows.map((row) => (
        <li key={row.label}>
          <span>
            {row.label}
            {row.badge ? <span className="ee-settings-new">{row.badge}</span> : null}
          </span>
          {row.kind === "toggle" ? (
            <SettingsToggle
              label={row.label}
              on={Boolean(state[row.label])}
              onChange={(v) => setState((f) => ({ ...f, [row.label]: v }))}
            />
          ) : row.kind === "link" ? (
            <button type="button" className="ee-link-btn">
              {String(state[row.label] ?? row.value)}
            </button>
          ) : (
            <strong>{String(state[row.label] ?? row.value)}</strong>
          )}
        </li>
      ))}
    </ul>
  );
}

function EditBtn() {
  return (
    <button type="button" className="ee-link-btn">
      <Pencil size={14} strokeWidth={1.5} aria-hidden="true" /> Edit
    </button>
  );
}

export function SalesSettings() {
  const [form, setForm] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(SALES_SETTINGS.formContent.map((r) => [r.label, r.value])),
  );
  const [products, setProducts] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(SALES_SETTINGS.products.map((r) => [r.label, r.value])),
  );
  const [progress, setProgress] = useState(() =>
    Object.fromEntries(SALES_SETTINGS.progressInvoicing.map((r) => [r.label, r.value])),
  );
  const [digest, setDigest] = useState(SALES_SETTINGS.customerAi.dailyDigest);
  const [post, setPost] = useState(() =>
    Object.fromEntries(SALES_SETTINGS.postInvoice.map((r) => [r.label, r.value])),
  );
  const [ageing, setAgeing] = useState(SALES_SETTINGS.statements.showAgeing);

  return (
    <SettingsLayout title="Sales" subtitle="Manage sales forms, payments and product preferences.">
      <div className="ee-settings-grid-2">
        <section className="ee-settings-card">
          <header className="ee-settings-card-head ee-settings-card-head-row">
            <div>
              <h2>Sales form content</h2>
              <p>Customize the information and fields that appear on your sales forms.</p>
            </div>
            <EditBtn />
          </header>
          <PrefList rows={SALES_SETTINGS.formContent} state={form} setState={setForm} />
        </section>

        <section className="ee-settings-card">
          <header className="ee-settings-card-head ee-settings-card-head-row">
            <div>
              <h2>Products and services</h2>
              <p>Manage how products and services appear and are tracked on your sales forms.</p>
            </div>
            <EditBtn />
          </header>
          <PrefList rows={SALES_SETTINGS.products} state={products} setState={setProducts} />
        </section>

        <section className="ee-settings-card">
          <header className="ee-settings-card-head ee-settings-card-head-row">
            <div>
              <h2>Invoice payments</h2>
              <p>Manage how your customers can pay and what appears on your invoices.</p>
            </div>
            <EditBtn />
          </header>
          <div className="ee-settings-row">
            <div className="ee-settings-row-label">Accept online payments</div>
            <button type="button" className="btn ee-btn-outline-blue btn-sm">
              Activate
            </button>
          </div>
          <div className="ee-settings-row">
            <div>
              <div className="ee-settings-row-label">Payment instructions</div>
              <div className="ee-settings-hint">{SALES_SETTINGS.invoicePayments.paymentInstructions}</div>
            </div>
          </div>
        </section>

        <section className="ee-settings-card">
          <header className="ee-settings-card-head ee-settings-card-head-row">
            <div>
              <h2>Progress invoicing</h2>
              <p>Manage options for creating and tracking progress invoices.</p>
            </div>
            <EditBtn />
          </header>
          {SALES_SETTINGS.progressInvoicing.map((row) => (
            <div className="ee-settings-row" key={row.label}>
              <div className="ee-settings-row-label">{row.label}</div>
              <SettingsToggle
                label={row.label}
                on={Boolean(progress[row.label])}
                onChange={(v) => setProgress((f) => ({ ...f, [row.label]: v }))}
              />
            </div>
          ))}
        </section>

        <section className="ee-settings-card">
          <header className="ee-settings-card-head ee-settings-card-head-row">
            <div>
              <h2>Messages</h2>
              <p>Manage the default email message sent with sales forms.</p>
            </div>
            <EditBtn />
          </header>
          <div className="ee-settings-row">
            <div className="ee-settings-row-label">Default email message sent with sales forms</div>
            <button type="button" className="ee-link-btn">
              {SALES_SETTINGS.messages.defaultEmail}
            </button>
          </div>
        </section>

        <section className="ee-settings-card">
          <header className="ee-settings-card-head ee-settings-card-head-row">
            <div>
              <h2>Post-invoice / Feedback survey</h2>
              <p>Collect work requests, reviews and referrals from your customers.</p>
            </div>
            <EditBtn />
          </header>
          {SALES_SETTINGS.postInvoice.map((row) => (
            <div className="ee-settings-row" key={row.label}>
              <div className="ee-settings-row-label">{row.label}</div>
              <SettingsToggle
                label={row.label}
                on={Boolean(post[row.label])}
                onChange={(v) => setPost((f) => ({ ...f, [row.label]: v }))}
              />
            </div>
          ))}
          <div className="ee-settings-row">
            <div className="ee-settings-row-label">Frequency</div>
            <strong>{SALES_SETTINGS.postInvoiceFrequency}</strong>
          </div>
        </section>

        <section className="ee-settings-card">
          <header className="ee-settings-card-head ee-settings-card-head-row">
            <div>
              <h2>Reminders</h2>
              <p>Set up and manage invoice reminder emails.</p>
            </div>
            <EditBtn />
          </header>
          <div className="ee-settings-row">
            <div className="ee-settings-row-label">Set up invoice reminder emails</div>
            <button type="button" className="ee-link-btn">
              {SALES_SETTINGS.reminders.manage}
            </button>
          </div>
        </section>

        <section className="ee-settings-card">
          <header className="ee-settings-card-head ee-settings-card-head-row">
            <div>
              <h2>Online delivery</h2>
              <p>Manage email options for all sales forms.</p>
            </div>
            <EditBtn />
          </header>
          <div className="ee-settings-row">
            <div className="ee-settings-row-label">Email options for all sales forms</div>
            <button type="button" className="ee-link-btn">
              {SALES_SETTINGS.onlineDelivery.configure}
            </button>
          </div>
        </section>

        <section className="ee-settings-card">
          <header className="ee-settings-card-head ee-settings-card-head-row">
            <div>
              <h2>Customer AI</h2>
              <p>Manage AI insights and email digests for your sales activity.</p>
            </div>
            <EditBtn />
          </header>
          <div className="ee-settings-row">
            <div className="ee-settings-row-label">Daily email digest</div>
            <SettingsToggle label="Daily email digest" on={digest} onChange={setDigest} />
          </div>
        </section>

        <section className="ee-settings-card">
          <header className="ee-settings-card-head ee-settings-card-head-row">
            <div>
              <h2>Statements</h2>
              <p>Manage statement layout and presentation options.</p>
            </div>
            <EditBtn />
          </header>
          <div className="ee-settings-row">
            <div className="ee-settings-row-label">Show ageing table at bottom of statement</div>
            <SettingsToggle label="Show ageing table" on={ageing} onChange={setAgeing} />
          </div>
        </section>
      </div>
    </SettingsLayout>
  );
}
