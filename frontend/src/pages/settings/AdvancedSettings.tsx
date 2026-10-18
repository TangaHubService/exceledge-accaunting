import { ChevronDown, Pencil } from "lucide-react";
import { useState } from "react";
import { SettingsLayout } from "../../components/settings/SettingsLayout";
import { SettingsToggle } from "../../components/settings/SettingsToggle";
import { ADVANCED_SETTINGS } from "../../lib/settings-dummy";

function EditBtn() {
  return (
    <button type="button" className="ee-link-btn">
      <Pencil size={14} strokeWidth={1.5} aria-hidden="true" /> Edit
    </button>
  );
}

function TextRow({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="ee-settings-row">
      <div>
        <div className="ee-settings-row-label">{label}</div>
        <div className="ee-settings-row-value">{value}</div>
        {note ? <div className="ee-settings-hint">{note}</div> : null}
      </div>
    </div>
  );
}

export function AdvancedSettings() {
  const d = ADVANCED_SETTINGS;
  const [closeBooks, setCloseBooks] = useState(d.closeTheBooks);
  const [acctNums, setAcctNums] = useState(d.enableAccountNumbers);
  const [classes, setClasses] = useState(d.trackClasses);
  const [locations, setLocations] = useState(d.trackLocations);
  const [prefill, setPrefill] = useState(d.prefillForms);
  const [autoInvoice, setAutoInvoice] = useState(d.autoInvoiceUnbilled);
  const [autoPay, setAutoPay] = useState(d.autoApplyBillPayments);
  const [projects, setProjects] = useState(d.projects);
  const [multi, setMulti] = useState(d.multicurrency);
  const [warnCheque, setWarnCheque] = useState(d.warnDuplicateCheque);
  const [warnBill, setWarnBill] = useState(d.warnDuplicateBill);
  const [warnJournal, setWarnJournal] = useState(d.warnDuplicateJournal);
  const [coaOpen, setCoaOpen] = useState(true);

  return (
    <SettingsLayout title="Advanced" subtitle="Manage accounting preferences and company configuration.">
      <section className="ee-settings-card">
        <header className="ee-settings-card-head ee-settings-card-head-row">
          <h2>Accounting method</h2>
          <EditBtn />
        </header>
        <TextRow label="Default accounting method" value={d.accountingMethod} />
      </section>

      <section className="ee-settings-card">
        <header className="ee-settings-card-head ee-settings-card-head-row">
          <h2>Communications with Excel Edge</h2>
          <EditBtn />
        </header>
        <div className="ee-settings-row">
          <button type="button" className="ee-link-btn" style={{ padding: 0 }}>
            Marketing preferences
          </button>
        </div>
      </section>

      <section className="ee-settings-card">
        <header className="ee-settings-card-head ee-settings-card-head-row">
          <h2>Accounting</h2>
          <EditBtn />
        </header>
        <TextRow label="First month of financial year" value={d.firstMonthFy} />
        <TextRow label="First month of tax year" value={d.firstMonthTax} />
        <TextRow label="Accounting method" value={d.accountingMethod} />
        <div className="ee-settings-row">
          <div className="ee-settings-row-label">Close the books</div>
          <SettingsToggle label="Close the books" on={closeBooks} onChange={setCloseBooks} />
        </div>
      </section>

      <section className="ee-settings-card">
        <header className="ee-settings-card-head ee-settings-card-head-row">
          <h2>Company type</h2>
          <EditBtn />
        </header>
        <TextRow
          label="Tax form"
          value={d.taxForm}
          note="Select the tax classification applicable to your business."
        />
      </section>

      <section className="ee-settings-card">
        <header className="ee-settings-card-head ee-settings-card-head-row">
          <button
            type="button"
            className="ee-settings-section-toggle"
            onClick={() => setCoaOpen((o) => !o)}
            aria-expanded={coaOpen}
          >
            <h2>Chart of accounts</h2>
            <ChevronDown size={18} strokeWidth={1.5} className={coaOpen ? "open" : ""} aria-hidden="true" />
          </button>
          <EditBtn />
        </header>
        {coaOpen ? (
          <div className="ee-settings-row">
            <div className="ee-settings-row-label">Enable account numbers</div>
            <SettingsToggle label="Enable account numbers" on={acctNums} onChange={setAcctNums} />
          </div>
        ) : null}
      </section>

      <section className="ee-settings-card">
        <header className="ee-settings-card-head ee-settings-card-head-row">
          <h2>Categories</h2>
          <EditBtn />
        </header>
        <div className="ee-settings-row">
          <div className="ee-settings-row-label">Track classes</div>
          <SettingsToggle label="Track classes" on={classes} onChange={setClasses} />
        </div>
        <div className="ee-settings-row">
          <div className="ee-settings-row-label">Track locations</div>
          <SettingsToggle label="Track locations" on={locations} onChange={setLocations} />
        </div>
      </section>

      <section className="ee-settings-card">
        <header className="ee-settings-card-head ee-settings-card-head-row">
          <h2>Automation</h2>
          <EditBtn />
        </header>
        <div className="ee-settings-row">
          <div className="ee-settings-row-label">Pre-fill forms with previously entered content</div>
          <SettingsToggle label="Pre-fill forms" on={prefill} onChange={setPrefill} />
        </div>
        <div className="ee-settings-row">
          <div className="ee-settings-row-label">Automatically invoice unbilled activity</div>
          <SettingsToggle label="Auto invoice unbilled" on={autoInvoice} onChange={setAutoInvoice} />
        </div>
        <div className="ee-settings-row">
          <div className="ee-settings-row-label">Automatically apply bill payments</div>
          <SettingsToggle label="Auto apply bill payments" on={autoPay} onChange={setAutoPay} />
        </div>
        <div className="ee-settings-row ee-settings-row-top">
          <div>
            <div className="ee-settings-row-label">Auto-enabled workflows</div>
            <div className="ee-settings-hint" style={{ marginTop: 4 }}>
              Reminders and follow-ups that run automatically for your company.
            </div>
          </div>
          <button type="button" className="ee-link-btn">
            Manage
          </button>
        </div>
      </section>

      <section className="ee-settings-card">
        <header className="ee-settings-card-head ee-settings-card-head-row">
          <h2>Projects</h2>
          <EditBtn />
        </header>
        <div className="ee-settings-row">
          <div className="ee-settings-row-label">Organise all job-related activity in one place</div>
          <SettingsToggle label="Projects" on={projects} onChange={setProjects} />
        </div>
      </section>

      <section className="ee-settings-card">
        <header className="ee-settings-card-head ee-settings-card-head-row">
          <h2>Language</h2>
          <EditBtn />
        </header>
        <TextRow label="Language" value={d.language} />
      </section>

      <section className="ee-settings-card">
        <header className="ee-settings-card-head ee-settings-card-head-row">
          <h2>Currency</h2>
          <EditBtn />
        </header>
        <TextRow label="Home currency" value={d.homeCurrency} />
        <div className="ee-settings-row">
          <div className="ee-settings-row-label">Multicurrency</div>
          <SettingsToggle label="Multicurrency" on={multi} onChange={setMulti} />
        </div>
      </section>

      <section className="ee-settings-card">
        <header className="ee-settings-card-head ee-settings-card-head-row">
          <h2>Other preferences</h2>
          <EditBtn />
        </header>
        <TextRow label="Date format" value={d.dateFormat} />
        <TextRow label="Currency format" value={d.currencyFormat} />
        <div className="ee-settings-row">
          <div className="ee-settings-row-label">Warn me if duplicate cheque number is used</div>
          <SettingsToggle label="Warn duplicate cheque" on={warnCheque} onChange={setWarnCheque} />
        </div>
        <div className="ee-settings-row">
          <div className="ee-settings-row-label">
            Warn me if I enter a bill number that&apos;s already been used for that supplier
          </div>
          <SettingsToggle label="Warn duplicate bill" on={warnBill} onChange={setWarnBill} />
        </div>
        <div className="ee-settings-row">
          <div className="ee-settings-row-label">Warn me if duplicate journal number is used</div>
          <SettingsToggle label="Warn duplicate journal" on={warnJournal} onChange={setWarnJournal} />
        </div>
        <TextRow label="Notify me if inactive for" value={d.notifyInactive} />
      </section>
    </SettingsLayout>
  );
}
