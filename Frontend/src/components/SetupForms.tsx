import { Plus } from "lucide-react";
import { type FormEvent, type ReactNode, useMemo, useState } from "react";
import { useCompany } from "../lib/company";
import { amount, calendarDate, date, humanize, toNumber } from "../lib/format";
import { useResource, useSession } from "../lib/session";
import type { Account, Customer, Supplier } from "../lib/types";
import { useFeedback } from "./feedback";
import { Footer, FormError, MoneyInput, parseAmount, useSubmit } from "./forms";
import { Select, type SelectOption } from "./Select";
import { Badge, Drawer, EmptyState, Field, Loadable, type Tone } from "./ui";

type Row = Record<string, unknown> | null | undefined;

/** The parts of GET /setup/snapshot the forms prefill from. */
export type FullSnapshot = {
  profile: Row;
  businessInfo: Row;
  currency: Row;
  policies: Row;
  localization: Row;
  defaults: Record<string, string | null> | null;
  inventory: Row;
  parties: Row;
  banking: Row;
  approvals: Row;
  years: Array<{ id: string; name: string; startDate: string; endDate: string; isCurrent: boolean; periodFrequency?: string; periods: Array<{ id: string; status: string }> }>;
  accounts: Account[];
};

export type SectionProps = {
  snap: FullSnapshot;
  sectionKey: string;
  status: string;
  activated: boolean;
  onSaved: () => void;
};

const API = "/api/v1/setup";
const APPROVABLE = new Set(["REQUIRES_REVIEW", "COMPLETED", "IN_PROGRESS"]);

function str(row: Row, key: string, fallback = ""): string {
  const v = row?.[key];
  if (v === null || v === undefined) return fallback;
  return typeof v === "string" ? v : String(v);
}

function bool(row: Row, key: string, fallback: boolean): boolean {
  const v = row?.[key];
  return typeof v === "boolean" ? v : fallback;
}

function day(row: Row, key: string): string {
  return str(row, key).slice(0, 10);
}

/** Drop blank values so optional fields aren't sent as empty strings. */
function compact(values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) if (v.trim()) out[k] = v.trim();
  return out;
}

function options(values: string[], labels: Record<string, string> = {}): SelectOption[] {
  return values.map((v) => ({ value: v, label: labels[v] ?? humanize(v) }));
}

/** Keeps a saved value that isn't in the preset list selectable. */
function withCurrent(list: SelectOption[], current: string): SelectOption[] {
  return current && !list.some((o) => o.value === current) ? [...list, { value: current, label: current }] : list;
}

function useFields<T extends Record<string, string>>(initial: T) {
  const [values, setValues] = useState(initial);
  const set = (key: keyof T) => (value: string) => setValues((v) => ({ ...v, [key]: value }));
  return [values, set] as const;
}

function Text({
  label,
  value,
  onChange,
  required,
  type = "text",
  hint,
  placeholder,
  className,
  disabled,
  maxLength,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  type?: string;
  hint?: ReactNode;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  maxLength?: number;
}) {
  return (
    <Field label={label} required={required} hint={hint} className={className}>
      <input
        className="input"
        type={type}
        required={required}
        disabled={disabled}
        maxLength={maxLength}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <div className="span-2">
      <label className="check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        {label}
      </label>
      {hint && <span className="field-hint" style={{ display: "block", marginLeft: 23 }}>{hint}</span>}
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="form-section-title span-2">{children}</div>;
}

/** Panel around one section's form: save, and approve for reviewers. */
function SectionPanel({
  title,
  description,
  sectionKey,
  status,
  formId,
  busy,
  error,
  onSubmit,
  onApproved,
  saveLabel = "Save",
  children,
  extra,
}: {
  title: string;
  description?: ReactNode;
  sectionKey: string;
  status: string;
  formId?: string;
  busy?: boolean;
  error?: string;
  onSubmit?: (e: FormEvent) => void;
  onApproved: () => void;
  saveLabel?: string;
  children: ReactNode;
  extra?: ReactNode;
}) {
  const { can, api } = useSession();
  const { toast } = useFeedback();
  const [approving, setApproving] = useState(false);
  const canEdit = can("setup:prepare");

  async function approve() {
    setApproving(true);
    try {
      await api(`${API}/sections/${sectionKey}/approve`, { method: "POST" });
      toast(`${title} approved`);
      onApproved();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setApproving(false);
    }
  }

  return (
    <div className="panel panel-body">
      <div className="filter-bar" style={{ alignItems: "flex-start" }}>
        <div className="grow">
          <h2 className="section-title">{title}</h2>
          {description && <p className="muted small" style={{ margin: "4px 0 0" }}>{description}</p>}
        </div>
        {can("setup:approve") && APPROVABLE.has(status) && (
          <button type="button" className="btn" disabled={approving} onClick={() => void approve()}>
            {approving ? "Approving…" : "Approve section"}
          </button>
        )}
      </div>
      {!canEdit && <div className="notice info" style={{ marginBottom: 12 }}>You can view these settings. Changing them needs setup preparation access.</div>}
      <FormError message={error ?? ""} />
      {onSubmit ? (
        <form id={formId} onSubmit={onSubmit}>
          <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
            <div className="form-grid">{children}</div>
          </fieldset>
          {canEdit && (
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
              {extra}
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? "Saving…" : saveLabel}
              </button>
            </div>
          )}
        </form>
      ) : (
        children
      )}
    </div>
  );
}

function put(api: ReturnType<typeof useSession>["api"], path: string, body: unknown, method = "PUT") {
  return api(`${API}${path}`, { method, body: JSON.stringify(body) });
}

const COUNTRIES: Record<string, string> = { RW: "Rwanda", UG: "Uganda", KE: "Kenya", TZ: "Tanzania", BI: "Burundi", CD: "DR Congo" };
const COUNTRY_OPTIONS = options(Object.keys(COUNTRIES), COUNTRIES);

export function ProfileForm({ snap, sectionKey, status, onSaved }: SectionProps) {
  const { api } = useSession();
  const p = snap.profile;
  const [f, set] = useFields({
    registeredName: str(p, "registeredName"),
    tradingName: str(p, "tradingName"),
    registrationNumber: str(p, "registrationNumber"),
    taxIdentificationNumber: str(p, "taxIdentificationNumber"),
    businessEmail: str(p, "businessEmail"),
    telephone: str(p, "telephone"),
    website: str(p, "website"),
    registeredAddress: str(p, "registeredAddress"),
    operatingAddress: str(p, "operatingAddress"),
    country: str(p, "country", "RW"),
    region: str(p, "region"),
    district: str(p, "district"),
    city: str(p, "city"),
    postalCode: str(p, "postalCode"),
    industry: str(p, "industry"),
    businessActivity: str(p, "businessActivity"),
    incorporationDate: day(p, "incorporationDate"),
    operationsStartDate: day(p, "operationsStartDate"),
  });
  const { busy, error, run } = useSubmit(onSaved);
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await put(api, "/profile", compact(f));
      return "Company profile saved";
    });
  }
  return (
    <SectionPanel title="Company profile" description="Legal identity used on invoices, statements and tax returns." sectionKey={sectionKey} status={status} formId="setup-profile" busy={busy} error={error} onSubmit={submit} onApproved={onSaved}>
      <Text label="Registered name" required value={f.registeredName} onChange={set("registeredName")} />
      <Text label="Trading name" value={f.tradingName} onChange={set("tradingName")} />
      <Text label="TIN" required value={f.taxIdentificationNumber} onChange={set("taxIdentificationNumber")} hint="Tax identification number from RRA." />
      <Text label="Registration number" value={f.registrationNumber} onChange={set("registrationNumber")} />
      <Field label="Country" required>
        <Select value={f.country} onChange={set("country")} options={withCurrent(COUNTRY_OPTIONS, f.country)} />
      </Field>
      <Text label="Industry" value={f.industry} onChange={set("industry")} />
      <Text label="Business email" type="email" value={f.businessEmail} onChange={set("businessEmail")} />
      <Text label="Telephone" value={f.telephone} onChange={set("telephone")} />
      <Text label="Website" value={f.website} onChange={set("website")} className="span-2" />
      <SectionTitle>Address</SectionTitle>
      <Text label="Registered address" value={f.registeredAddress} onChange={set("registeredAddress")} />
      <Text label="Operating address" value={f.operatingAddress} onChange={set("operatingAddress")} />
      <Text label="Province / region" value={f.region} onChange={set("region")} />
      <Text label="District" value={f.district} onChange={set("district")} />
      <Text label="City" value={f.city} onChange={set("city")} />
      <Text label="Postal code" value={f.postalCode} onChange={set("postalCode")} />
      <SectionTitle>Operations</SectionTitle>
      <Text label="Business activity" value={f.businessActivity} onChange={set("businessActivity")} className="span-2" />
      <Text label="Incorporation date" type="date" value={f.incorporationDate} onChange={set("incorporationDate")} />
      <Text label="Operations start date" type="date" value={f.operationsStartDate} onChange={set("operationsStartDate")} />
    </SectionPanel>
  );
}

const BASES = options(["ACCRUAL", "CASH", "MODIFIED_CASH"]);
const FRAMEWORKS = options(["IFRS", "IFRS_SME", "IPSAS", "LOCAL_GAAP", "INTERNAL"], { IFRS: "IFRS", IFRS_SME: "IFRS for SMEs", IPSAS: "IPSAS", LOCAL_GAAP: "Local GAAP", INTERNAL: "Internal" });
const VALUATION = options(["WEIGHTED_AVERAGE", "FIFO", "SPECIFIC_IDENTIFICATION"], { FIFO: "FIFO (first in, first out)" });

export function BusinessInfoForm({ snap, sectionKey, status, onSaved }: SectionProps) {
  const { api } = useSession();
  const b = snap.businessInfo;
  const [f, set] = useFields({
    businessType: str(b, "businessType"),
    legalStructure: str(b, "legalStructure"),
    industry: str(b, "industry"),
    accountingCommencementDate: day(b, "accountingCommencementDate"),
    numberOfBranches: str(b, "numberOfBranches"),
    headOffice: str(b, "headOffice"),
    reportingStructure: str(b, "reportingStructure"),
    accountingBasis: str(b, "accountingBasis", "ACCRUAL"),
    reportingFramework: str(b, "reportingFramework", "IFRS_SME"),
    defaultLanguage: str(b, "defaultLanguage", "en"),
    dateFormat: str(b, "dateFormat", "YYYY-MM-DD"),
    numberFormat: str(b, "numberFormat", "#,##0.00"),
    timeZone: str(b, "timeZone", "Africa/Kigali"),
  });
  const { busy, error, setError, run } = useSubmit(onSaved);
  function submit(e: FormEvent) {
    e.preventDefault();
    const { numberOfBranches, ...rest } = f;
    const branches = numberOfBranches.trim() ? Number(numberOfBranches) : undefined;
    if (branches !== undefined && !(Number.isInteger(branches) && branches >= 0)) return setError("Number of branches must be a whole number.");
    void run(async () => {
      await put(api, "/business-info", { ...compact(rest), numberOfBranches: branches });
      return "Business details saved";
    });
  }
  const types = withCurrent(options(["RETAIL", "WHOLESALE", "MANUFACTURING", "SERVICES", "HOSPITALITY", "CONSTRUCTION", "AGRICULTURE", "NGO", "OTHER"]), f.businessType);
  const structures = withCurrent(options(["SOLE_PROPRIETOR", "PARTNERSHIP", "LIMITED_COMPANY", "PUBLIC_COMPANY", "COOPERATIVE", "NGO"]), f.legalStructure);
  return (
    <SectionPanel title="Business type and accounting basis" description="How the books are kept and which framework the statements follow." sectionKey={sectionKey} status={status} formId="setup-business" busy={busy} error={error} onSubmit={submit} onApproved={onSaved}>
      <Field label="Business type">
        <Select value={f.businessType} onChange={set("businessType")} options={types} placeholder="Choose a type" />
      </Field>
      <Field label="Legal structure">
        <Select value={f.legalStructure} onChange={set("legalStructure")} options={structures} placeholder="Choose a structure" />
      </Field>
      <Field label="Accounting basis" required>
        <Select value={f.accountingBasis} onChange={set("accountingBasis")} options={BASES} />
      </Field>
      <Field label="Reporting framework" required>
        <Select value={f.reportingFramework} onChange={set("reportingFramework")} options={FRAMEWORKS} />
      </Field>
      <Text label="Industry" value={f.industry} onChange={set("industry")} />
      <Text label="Accounting start date" type="date" value={f.accountingCommencementDate} onChange={set("accountingCommencementDate")} />
      <Text label="Number of branches" type="number" value={f.numberOfBranches} onChange={set("numberOfBranches")} />
      <Text label="Head office" value={f.headOffice} onChange={set("headOffice")} />
      <Text label="Reporting structure" value={f.reportingStructure} onChange={set("reportingStructure")} className="span-2" placeholder="e.g. Head office with branch reporting" />
      <SectionTitle>Display</SectionTitle>
      <Field label="Language">
        <Select value={f.defaultLanguage} onChange={set("defaultLanguage")} options={withCurrent(options(["en", "fr", "rw"], { en: "English", fr: "French", rw: "Kinyarwanda" }), f.defaultLanguage)} />
      </Field>
      <Text label="Time zone" value={f.timeZone} onChange={set("timeZone")} />
      <Text label="Date format" value={f.dateFormat} onChange={set("dateFormat")} />
      <Text label="Number format" value={f.numberFormat} onChange={set("numberFormat")} />
    </SectionPanel>
  );
}

type Year = FullSnapshot["years"][number];

export function FinancialYearsForm({ snap, sectionKey, status, onSaved }: SectionProps) {
  const { can, api } = useSession();
  const { toast } = useFeedback();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Year | null>(null);

  async function makeCurrent(y: Year) {
    try {
      await put(api, `/financial-years/${y.id}`, { isCurrent: true });
      toast(`${y.name} is now the current year`);
      onSaved();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  return (
    <SectionPanel title="Financial years and periods" description="Each year is split into periods that can be opened, closed and locked." sectionKey={sectionKey} status={status} onApproved={onSaved}>
      {snap.years.length === 0 ? (
        <EmptyState title="No financial year yet" body="Create the first year to generate its accounting periods." />
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Year</th>
              <th>Dates</th>
              <th className="num">Periods</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {snap.years.map((y) => (
              <tr key={y.id}>
                <td>
                  {y.name} {y.isCurrent && <Badge tone="info">Current</Badge>}
                  {y.periodFrequency && <span className="sub">{humanize(y.periodFrequency)} periods</span>}
                </td>
                <td className="nowrap">
                  {calendarDate(y.startDate)} – {calendarDate(y.endDate)}
                </td>
                <td className="num">
                  {y.periods.length}
                  <span className="sub">{y.periods.filter((p) => p.status === "OPEN" || p.status === "REOPENED").length} open</span>
                </td>
                <td className="num nowrap">
                  {can("setup:prepare") && (
                    <>
                      {!y.isCurrent && (
                        <button type="button" className="btn btn-sm" onClick={() => void makeCurrent(y)}>
                          Make current
                        </button>
                      )}{" "}
                      <button type="button" className="btn btn-sm" onClick={() => setEditing(y)}>
                        Rename
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {can("setup:prepare") && (
        <div style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" />
            New financial year
          </button>
        </div>
      )}
      {creating && (
        <YearDrawer
          years={snap.years}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            onSaved();
          }}
        />
      )}
      {editing && (
        <RenameYearDrawer
          year={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onSaved();
          }}
        />
      )}
    </SectionPanel>
  );
}

function YearDrawer({ years, onClose, onSaved }: { years: Year[]; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const last = [...years].sort((a, b) => b.endDate.localeCompare(a.endDate))[0];
  const startYear = last ? new Date(last.endDate).getUTCFullYear() + 1 : new Date().getUTCFullYear();
  const [f, set] = useFields({
    name: `FY ${startYear}`,
    startDate: `${startYear}-01-01`,
    endDate: `${startYear}-12-31`,
    periodFrequency: "MONTHLY",
    closingPolicy: "",
  });
  const [isCurrent, setIsCurrent] = useState(years.length === 0);
  const { busy, error, setError, run } = useSubmit(onSaved);
  function submit(e: FormEvent) {
    e.preventDefault();
    if (f.endDate <= f.startDate) return setError("The end date must be after the start date.");
    void run(async () => {
      await put(api, "/financial-years", { ...compact(f), isCurrent }, "POST");
      return `${f.name} created`;
    });
  }
  return (
    <Drawer title="New financial year" onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Create year" formId="year-form" />}>
      <FormError message={error} />
      <form id="year-form" onSubmit={submit} className="form-grid">
        <Text label="Name" required value={f.name} onChange={set("name")} className="span-2" />
        <Text label="Start date" type="date" required value={f.startDate} onChange={set("startDate")} />
        <Text label="End date" type="date" required value={f.endDate} onChange={set("endDate")} />
        <Field label="Periods" required className="span-2">
          <Select value={f.periodFrequency} onChange={set("periodFrequency")} options={options(["MONTHLY", "QUARTERLY", "SEMI_ANNUAL", "ANNUAL"])} />
        </Field>
        <Text label="Closing policy" value={f.closingPolicy} onChange={set("closingPolicy")} className="span-2" placeholder="e.g. Close each month within 10 days" />
        <Check label="Make this the current year" checked={isCurrent} onChange={setIsCurrent} />
      </form>
    </Drawer>
  );
}

function RenameYearDrawer({ year, onClose, onSaved }: { year: Year; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const [name, setName] = useState(year.name);
  const { busy, error, run } = useSubmit(onSaved);
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await put(api, `/financial-years/${year.id}`, { name: name.trim() });
      return "Financial year renamed";
    });
  }
  return (
    <Drawer title={`Rename ${year.name}`} onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Save" formId="rename-year-form" />}>
      <FormError message={error} />
      <form id="rename-year-form" onSubmit={submit}>
        <Text label="Name" required value={name} onChange={setName} />
      </form>
    </Drawer>
  );
}

const LOCKED_AFTER_ACTIVATION = "Locked once accounting is active.";

export function CurrencyForm({ snap, sectionKey, status, activated, onSaved }: SectionProps) {
  const { api } = useSession();
  const c = snap.currency;
  const [f, set] = useFields({
    functionalCurrency: str(c, "functionalCurrency", "RWF"),
    reportingCurrency: str(c, "reportingCurrency"),
    currencySymbol: str(c, "currencySymbol"),
    displayFormat: str(c, "displayFormat"),
    decimalPrecision: str(c, "decimalPrecision", "0"),
    exchangeRateSource: str(c, "exchangeRateSource", "BNR"),
    exchangeRateUpdateFrequency: str(c, "exchangeRateUpdateFrequency", "DAILY"),
  });
  const [multi, setMulti] = useState(bool(c, "multiCurrencyEnabled", false));
  const { busy, error, setError, run } = useSubmit(onSaved);
  function submit(e: FormEvent) {
    e.preventDefault();
    const { decimalPrecision, ...rest } = f;
    const precision = Number(decimalPrecision);
    if (!/^[A-Z]{3}$/.test(f.functionalCurrency)) return setError("Use a three-letter currency code such as RWF.");
    if (!(Number.isInteger(precision) && precision >= 0 && precision <= 6)) return setError("Decimal places must be between 0 and 6.");
    void run(async () => {
      await put(api, "/currency", { ...compact(rest), multiCurrencyEnabled: multi, decimalPrecision: precision });
      return "Currency settings saved";
    });
  }
  return (
    <SectionPanel title="Currency" description="The functional currency every ledger amount is kept in." sectionKey={sectionKey} status={status} formId="setup-currency" busy={busy} error={error} onSubmit={submit} onApproved={onSaved}>
      <Text
        label="Functional currency"
        required
        maxLength={3}
        disabled={activated}
        value={f.functionalCurrency}
        onChange={(v) => set("functionalCurrency")(v.toUpperCase())}
        hint={activated ? LOCKED_AFTER_ACTIVATION : "Three-letter code, e.g. RWF."}
      />
      <Text label="Reporting currency" maxLength={3} value={f.reportingCurrency} onChange={(v) => set("reportingCurrency")(v.toUpperCase())} hint="Leave blank to report in the functional currency." />
      <Text label="Currency symbol" value={f.currencySymbol} onChange={set("currencySymbol")} placeholder="FRw" />
      <Text label="Decimal places" type="number" value={f.decimalPrecision} onChange={set("decimalPrecision")} />
      <Text label="Display format" value={f.displayFormat} onChange={set("displayFormat")} placeholder="#,##0" />
      <Text label="Exchange rate source" value={f.exchangeRateSource} onChange={set("exchangeRateSource")} />
      <Field label="Rate update frequency">
        <Select value={f.exchangeRateUpdateFrequency} onChange={set("exchangeRateUpdateFrequency")} options={withCurrent(options(["DAILY", "WEEKLY", "MONTHLY", "MANUAL"]), f.exchangeRateUpdateFrequency)} />
      </Field>
      <Check label="Allow transactions in foreign currencies" checked={multi} onChange={setMulti} />
    </SectionPanel>
  );
}

export function PoliciesForm({ snap, sectionKey, status, activated, onSaved }: SectionProps) {
  const { api } = useSession();
  const p = snap.policies;
  const [f, set] = useFields({
    accountingBasis: str(p, "accountingBasis", "ACCRUAL"),
    inventoryValuationMethod: str(p, "inventoryValuationMethod", "WEIGHTED_AVERAGE"),
    depreciationPolicy: str(p, "depreciationPolicy"),
    revenueRecognitionMethod: str(p, "revenueRecognitionMethod"),
    expenseRecognitionMethod: str(p, "expenseRecognitionMethod"),
    badDebtPolicy: str(p, "badDebtPolicy"),
    fxRevaluationPolicy: str(p, "fxRevaluationPolicy"),
    documentRetentionPeriod: str(p, "documentRetentionPeriod"),
    materialityThreshold: p?.materialityThreshold != null ? amount(toNumber(p.materialityThreshold as string)) : "",
    roundingPolicy: str(p, "roundingPolicy"),
    periodClosingPolicy: str(p, "periodClosingPolicy"),
  });
  const { busy, error, setError, run } = useSubmit(onSaved);
  function submit(e: FormEvent) {
    e.preventDefault();
    const { materialityThreshold, inventoryValuationMethod, ...rest } = f;
    const threshold = materialityThreshold.trim() ? parseAmount(materialityThreshold) : undefined;
    if (threshold !== undefined && !(threshold >= 0)) return setError("Materiality threshold must be a positive amount.");
    void run(async () => {
      await put(api, "/policies", { ...compact(rest), ...(activated ? {} : { inventoryValuationMethod }), materialityThreshold: threshold });
      return "Accounting policies saved";
    });
  }
  return (
    <SectionPanel title="Accounting policies" description="Policies that decide how transactions are measured and recognised." sectionKey={sectionKey} status={status} formId="setup-policies" busy={busy} error={error} onSubmit={submit} onApproved={onSaved}>
      <Field label="Accounting basis" required>
        <Select value={f.accountingBasis} onChange={set("accountingBasis")} options={BASES} />
      </Field>
      <Field label="Inventory valuation" required hint={activated ? LOCKED_AFTER_ACTIVATION : undefined}>
        <Select value={f.inventoryValuationMethod} onChange={set("inventoryValuationMethod")} options={VALUATION} disabled={activated} />
      </Field>
      <Field label="Depreciation">
        <Select value={f.depreciationPolicy} onChange={set("depreciationPolicy")} options={withCurrent(options(["STRAIGHT_LINE", "REDUCING_BALANCE"]), f.depreciationPolicy)} placeholder="Choose a method" />
      </Field>
      <Text label="Materiality threshold" value={f.materialityThreshold} onChange={set("materialityThreshold")} />
      <Text label="Revenue recognition" value={f.revenueRecognitionMethod} onChange={set("revenueRecognitionMethod")} placeholder="On delivery" />
      <Text label="Expense recognition" value={f.expenseRecognitionMethod} onChange={set("expenseRecognitionMethod")} placeholder="When incurred" />
      <Text label="Bad debt policy" value={f.badDebtPolicy} onChange={set("badDebtPolicy")} placeholder="Provide for debts over 180 days" />
      <Text label="Foreign exchange revaluation" value={f.fxRevaluationPolicy} onChange={set("fxRevaluationPolicy")} placeholder="Month end" />
      <Text label="Document retention" value={f.documentRetentionPeriod} onChange={set("documentRetentionPeriod")} placeholder="10 years" />
      <Text label="Rounding" value={f.roundingPolicy} onChange={set("roundingPolicy")} placeholder="Round half up" />
      <Text label="Period closing" value={f.periodClosingPolicy} onChange={set("periodClosingPolicy")} className="span-2" placeholder="Close each month within 10 working days" />
    </SectionPanel>
  );
}

export function LocalizationForm({ snap, sectionKey, status, onSaved }: SectionProps) {
  const { api } = useSession();
  const l = snap.localization;
  const [f, set] = useFields({
    countryOfRegistration: str(l, "countryOfRegistration", "RW"),
    localizationPackage: str(l, "localizationPackage", "RW"),
    taxAuthority: str(l, "taxAuthority", "RRA"),
    taxpayerCategory: str(l, "taxpayerCategory"),
    taxFilingFrequency: str(l, "taxFilingFrequency"),
    governmentIntegrationStatus: str(l, "governmentIntegrationStatus"),
    payrollCompliancePackage: str(l, "payrollCompliancePackage"),
  });
  const [ebm, setEbm] = useState(bool(l, "electronicInvoicingRequired", true));
  const { busy, error, run } = useSubmit(onSaved);
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await put(api, "/localization", { ...compact(f), electronicInvoicingRequired: ebm });
      return "Tax and localisation saved";
    });
  }
  return (
    <SectionPanel title="Tax and localisation" description="Country rules for tax codes, filing and e-invoicing." sectionKey={sectionKey} status={status} formId="setup-localization" busy={busy} error={error} onSubmit={submit} onApproved={onSaved}>
      <Field label="Country of registration" required>
        <Select value={f.countryOfRegistration} onChange={set("countryOfRegistration")} options={withCurrent(COUNTRY_OPTIONS, f.countryOfRegistration)} />
      </Field>
      <Field label="Localisation package" required>
        <Select value={f.localizationPackage} onChange={set("localizationPackage")} options={withCurrent(COUNTRY_OPTIONS, f.localizationPackage)} />
      </Field>
      <Text label="Tax authority" value={f.taxAuthority} onChange={set("taxAuthority")} />
      <Field label="Taxpayer category">
        <Select value={f.taxpayerCategory} onChange={set("taxpayerCategory")} options={withCurrent(options(["SMALL", "MEDIUM", "LARGE"]), f.taxpayerCategory)} placeholder="Choose a category" />
      </Field>
      <Field label="Filing frequency">
        <Select value={f.taxFilingFrequency} onChange={set("taxFilingFrequency")} options={withCurrent(options(["MONTHLY", "QUARTERLY", "ANNUAL"]), f.taxFilingFrequency)} placeholder="Choose a frequency" />
      </Field>
      <Text label="Government integration" value={f.governmentIntegrationStatus} onChange={set("governmentIntegrationStatus")} placeholder="EBM connected" />
      <Text label="Payroll compliance package" value={f.payrollCompliancePackage} onChange={set("payrollCompliancePackage")} className="span-2" />
      <Check label="Electronic invoicing (EBM) is required" checked={ebm} onChange={setEbm} />
    </SectionPanel>
  );
}

const DEFAULT_ACCOUNT_GROUPS: Array<{ title: string; keys: Array<[string, string]> }> = [
  {
    title: "Sales and receivables",
    keys: [
      ["accountsReceivableId", "Accounts receivable"],
      ["salesRevenueId", "Sales revenue"],
      ["serviceRevenueId", "Service revenue"],
      ["salesDiscountsId", "Sales discounts"],
      ["salesReturnsId", "Sales returns"],
      ["customerDepositsId", "Customer deposits"],
      ["badDebtExpenseId", "Bad debt expense"],
      ["allowanceDoubtfulDebtsId", "Allowance for doubtful debts"],
    ],
  },
  {
    title: "Purchases and payables",
    keys: [
      ["accountsPayableId", "Accounts payable"],
      ["purchasesId", "Purchases"],
      ["purchaseDiscountsId", "Purchase discounts"],
      ["purchaseReturnsId", "Purchase returns"],
      ["supplierAdvancesId", "Supplier advances"],
      ["accruedExpensesId", "Accrued expenses"],
    ],
  },
  {
    title: "Cash and banking",
    keys: [
      ["defaultCashAccountId", "Cash on hand"],
      ["defaultBankAccountId", "Bank"],
      ["pettyCashAccountId", "Petty cash"],
      ["mobileMoneyClearingId", "Mobile money clearing"],
      ["undepositedFundsId", "Undeposited funds"],
      ["bankChargesId", "Bank charges"],
      ["interestIncomeId", "Interest income"],
      ["paymentProcessingChargesId", "Payment processing charges"],
    ],
  },
  {
    title: "Inventory",
    keys: [
      ["inventoryAssetId", "Inventory asset"],
      ["costOfSalesId", "Cost of sales"],
      ["inventoryAdjustmentId", "Inventory adjustments"],
      ["inventoryGainId", "Inventory gains"],
      ["inventoryLossId", "Inventory losses"],
      ["inventoryWriteOffId", "Inventory write-offs"],
      ["grniId", "Goods received not invoiced"],
      ["goodsInTransitId", "Goods in transit"],
    ],
  },
  {
    title: "Taxes",
    keys: [
      ["outputTaxPayableId", "Output VAT payable"],
      ["inputTaxReceivableId", "Input VAT receivable"],
      ["withholdingTaxPayableId", "Withholding tax payable"],
      ["withholdingTaxReceivableId", "Withholding tax receivable"],
      ["payrollTaxPayableId", "Payroll tax payable"],
      ["otherStatutoryLiabilitiesId", "Other statutory liabilities"],
    ],
  },
  {
    title: "Payroll",
    keys: [
      ["salariesWagesExpenseId", "Salaries and wages"],
      ["payrollPayableId", "Payroll payable"],
      ["employeeBenefitsExpenseId", "Employee benefits"],
      ["employeeDeductionsPayableId", "Employee deductions payable"],
      ["employerContributionsExpenseId", "Employer contributions"],
    ],
  },
  {
    title: "Fixed assets",
    keys: [
      ["fixedAssetCostId", "Fixed asset cost"],
      ["accumulatedDepreciationId", "Accumulated depreciation"],
      ["depreciationExpenseId", "Depreciation expense"],
      ["assetDisposalId", "Asset disposal"],
      ["gainOnDisposalId", "Gain on disposal"],
      ["lossOnDisposalId", "Loss on disposal"],
      ["assetRevaluationReserveId", "Revaluation reserve"],
      ["revaluationLossId", "Revaluation loss"],
    ],
  },
  {
    title: "General",
    keys: [
      ["retainedEarningsId", "Retained earnings"],
      ["currentYearEarningsId", "Current year earnings"],
      ["suspenseAccountId", "Suspense"],
      ["roundingDifferenceId", "Rounding differences"],
      ["fxGainId", "Foreign exchange gain"],
      ["fxLossId", "Foreign exchange loss"],
    ],
  },
];

export function accountOptions(accounts: Account[], filter: (a: Account) => boolean = (a) => a.isActive): SelectOption[] {
  return accounts
    .filter(filter)
    .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }))
    .map((a) => ({ value: a.id, label: a.name, prefix: a.code, group: humanize(a.type) }));
}

export function DefaultAccountsForm({ snap, sectionKey, status, onSaved }: SectionProps) {
  const { api } = useSession();
  const coa = useResource<Account[]>("/api/v1/coa");
  const saved = snap.defaults ?? {};
  const [map, setMap] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const g of DEFAULT_ACCOUNT_GROUPS) for (const [k] of g.keys) out[k] = saved[k] ?? "";
    return out;
  });
  const { busy, error, setError, run } = useSubmit(onSaved);
  const filling = useSubmit(onSaved);
  const opts = useMemo(() => accountOptions(coa.data ?? snap.accounts), [coa.data, snap.accounts]);
  const changed = Object.fromEntries(Object.entries(map).filter(([k, v]) => v && v !== (saved[k] ?? "")));

  function submit(e: FormEvent) {
    e.preventDefault();
    if (Object.keys(changed).length === 0) return setError("Nothing has changed.");
    void run(async () => {
      await put(api, "/default-accounts", changed);
      return "Default posting accounts saved";
    });
  }

  function fillGaps() {
    void filling.run(async () => {
      await api(`${API}/default-accounts/ensure`, { method: "POST" });
      return "Missing mappings filled with standard accounts";
    });
  }

  return (
    <SectionPanel
      title="Default posting accounts"
      description="Ledger accounts automatic postings use when a document doesn't name one."
      sectionKey={sectionKey}
      status={status}
      formId="setup-defaults"
      busy={busy}
      error={error || filling.error}
      onSubmit={submit}
      onApproved={onSaved}
      saveLabel={Object.keys(changed).length ? `Save ${Object.keys(changed).length} change${Object.keys(changed).length === 1 ? "" : "s"}` : "Save"}
      extra={
        <button type="button" className="btn" disabled={filling.busy} onClick={fillGaps}>
          {filling.busy ? "Filling…" : "Fill gaps with standard accounts"}
        </button>
      }
    >
      {DEFAULT_ACCOUNT_GROUPS.map((g) => (
        <FragmentGroup key={g.title} title={g.title}>
          {g.keys.map(([key, label]) => (
            <Field key={key} label={label}>
              <Select value={map[key]} onChange={(v) => setMap((m) => ({ ...m, [key]: v }))} options={opts} placeholder="Not mapped" />
            </Field>
          ))}
        </FragmentGroup>
      ))}
    </SectionPanel>
  );
}

function FragmentGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      {children}
    </>
  );
}

export function InventorySettingsForm({ snap, sectionKey, status, activated, onSaved }: SectionProps) {
  const { api } = useSession();
  const i = snap.inventory;
  const [f, set] = useFields({
    valuationMethod: str(i, "valuationMethod", str(snap.policies, "inventoryValuationMethod", "WEIGHTED_AVERAGE")),
    negativeInventoryPolicy: str(i, "negativeInventoryPolicy", "PREVENT"),
  });
  const [cogs, setCogs] = useState(bool(i, "automaticCogsPosting", true));
  const [adjApproval, setAdjApproval] = useState(bool(i, "adjustmentRequiresApproval", true));
  const [countApproval, setCountApproval] = useState(bool(i, "stockCountRequiresApproval", true));
  const { busy, error, run } = useSubmit(onSaved);
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await put(api, "/inventory-settings", {
        ...(activated ? {} : { valuationMethod: f.valuationMethod }),
        negativeInventoryPolicy: f.negativeInventoryPolicy,
        automaticCogsPosting: cogs,
        adjustmentRequiresApproval: adjApproval,
        stockCountRequiresApproval: countApproval,
      });
      return "Inventory settings saved";
    });
  }
  return (
    <SectionPanel title="Inventory accounting" description="How stock is valued and when cost of sales is posted." sectionKey={sectionKey} status={status} formId="setup-inventory" busy={busy} error={error} onSubmit={submit} onApproved={onSaved}>
      <Field label="Valuation method" required hint={activated ? LOCKED_AFTER_ACTIVATION : undefined}>
        <Select value={f.valuationMethod} onChange={set("valuationMethod")} options={VALUATION} disabled={activated} />
      </Field>
      <Field label="Negative stock">
        <Select value={f.negativeInventoryPolicy} onChange={set("negativeInventoryPolicy")} options={withCurrent(options(["PREVENT", "WARN", "ALLOW"], { PREVENT: "Prevent sales below zero", WARN: "Warn but allow", ALLOW: "Allow" }), f.negativeInventoryPolicy)} />
      </Field>
      <Check label="Post cost of sales automatically when goods are sold" checked={cogs} onChange={setCogs} />
      <Check label="Stock adjustments need approval" checked={adjApproval} onChange={setAdjApproval} />
      <Check label="Stock count results need approval" checked={countApproval} onChange={setCountApproval} />
    </SectionPanel>
  );
}

const TERMS = options(["DUE_ON_RECEIPT", "NET7", "NET15", "NET30", "NET45", "NET60", "NET90"], { NET7: "Net 7 days", NET15: "Net 15 days", NET30: "Net 30 days", NET45: "Net 45 days", NET60: "Net 60 days", NET90: "Net 90 days" });

export function PartyDefaultsForm({ snap, sectionKey, status, onSaved }: SectionProps) {
  const { api } = useSession();
  const p = snap.parties;
  const [f, set] = useFields({
    customerPaymentTerms: str(p, "customerPaymentTerms", "NET30"),
    defaultCreditLimit: p?.defaultCreditLimit != null ? amount(toNumber(p.defaultCreditLimit as string)) : "",
    defaultCustomerCurrency: str(p, "defaultCustomerCurrency"),
    defaultSalesTaxCode: str(p, "defaultSalesTaxCode"),
    supplierPaymentTerms: str(p, "supplierPaymentTerms", "NET30"),
    defaultSupplierCurrency: str(p, "defaultSupplierCurrency"),
    withholdingTaxStatus: str(p, "withholdingTaxStatus"),
  });
  const [supplierApproval, setSupplierApproval] = useState(bool(p, "supplierApprovalRequired", true));
  const { busy, error, setError, run } = useSubmit(onSaved);
  function submit(e: FormEvent) {
    e.preventDefault();
    const { defaultCreditLimit, ...rest } = f;
    const limit = defaultCreditLimit.trim() ? parseAmount(defaultCreditLimit) : undefined;
    if (limit !== undefined && !(limit >= 0)) return setError("Credit limit must be zero or more.");
    void run(async () => {
      await put(api, "/party-defaults", { ...compact(rest), defaultCreditLimit: limit, supplierApprovalRequired: supplierApproval });
      return "Customer and supplier defaults saved";
    });
  }
  return (
    <SectionPanel title="Customer and supplier defaults" description="Starting values for new customers and suppliers." sectionKey={sectionKey} status={status} formId="setup-parties" busy={busy} error={error} onSubmit={submit} onApproved={onSaved}>
      <SectionTitle>Customers</SectionTitle>
      <Field label="Payment terms">
        <Select value={f.customerPaymentTerms} onChange={set("customerPaymentTerms")} options={withCurrent(TERMS, f.customerPaymentTerms)} />
      </Field>
      <Field label="Credit limit">
        <MoneyInput value={f.defaultCreditLimit} onChange={set("defaultCreditLimit")} />
      </Field>
      <Text label="Currency" maxLength={3} value={f.defaultCustomerCurrency} onChange={(v) => set("defaultCustomerCurrency")(v.toUpperCase())} placeholder="RWF" />
      <Text label="Sales tax code" value={f.defaultSalesTaxCode} onChange={set("defaultSalesTaxCode")} placeholder="VAT18" />
      <SectionTitle>Suppliers</SectionTitle>
      <Field label="Payment terms">
        <Select value={f.supplierPaymentTerms} onChange={set("supplierPaymentTerms")} options={withCurrent(TERMS, f.supplierPaymentTerms)} />
      </Field>
      <Text label="Currency" maxLength={3} value={f.defaultSupplierCurrency} onChange={(v) => set("defaultSupplierCurrency")(v.toUpperCase())} placeholder="RWF" />
      <Field label="Withholding tax">
        <Select value={f.withholdingTaxStatus} onChange={set("withholdingTaxStatus")} options={withCurrent(options(["NOT_APPLICABLE", "WITHHOLD", "EXEMPT"], { WITHHOLD: "Withhold on payments" }), f.withholdingTaxStatus)} placeholder="Choose" />
      </Field>
      <Check label="New suppliers need approval before use" checked={supplierApproval} onChange={setSupplierApproval} />
    </SectionPanel>
  );
}

const PAY_METHODS = options(["CASH", "BANK", "MOBILE_MONEY", "CHEQUE", "EFT"], { EFT: "EFT" });

export function BankingForm({ snap, sectionKey, status, onSaved }: SectionProps) {
  const { api } = useSession();
  const b = snap.banking;
  const [f, set] = useFields({
    defaultReceiptMethod: str(b, "defaultReceiptMethod", "CASH"),
    defaultPaymentMethod: str(b, "defaultPaymentMethod", "BANK"),
    bankReconciliationMethod: str(b, "bankReconciliationMethod", "STATEMENT"),
  });
  const [methodMap, setMethodMap] = useState<Record<string, string>>(() => {
    const raw = b?.paymentMethodAccountMap;
    return raw && typeof raw === "object" ? { ...(raw as Record<string, string>) } : {};
  });
  const assetOptions = useMemo(() => accountOptions(snap.accounts, (a) => a.isActive && a.type === "ASSET"), [snap.accounts]);
  const { busy, error, run } = useSubmit(onSaved);
  function submit(e: FormEvent) {
    e.preventDefault();
    const cleaned = Object.fromEntries(Object.entries(methodMap).filter(([, v]) => v));
    void run(async () => {
      await put(api, "/banking", { ...compact(f), paymentMethodAccountMap: cleaned });
      return "Banking settings saved";
    });
  }
  return (
    <SectionPanel title="Banking and payment methods" description="Default methods and which account each payment method settles through." sectionKey={sectionKey} status={status} formId="setup-banking" busy={busy} error={error} onSubmit={submit} onApproved={onSaved}>
      <Field label="Default receipt method">
        <Select value={f.defaultReceiptMethod} onChange={set("defaultReceiptMethod")} options={withCurrent(PAY_METHODS, f.defaultReceiptMethod)} />
      </Field>
      <Field label="Default payment method">
        <Select value={f.defaultPaymentMethod} onChange={set("defaultPaymentMethod")} options={withCurrent(PAY_METHODS, f.defaultPaymentMethod)} />
      </Field>
      <Field label="Bank reconciliation" className="span-2">
        <Select value={f.bankReconciliationMethod} onChange={set("bankReconciliationMethod")} options={withCurrent(options(["STATEMENT", "MANUAL"], { STATEMENT: "Match against imported statements", MANUAL: "Tick off manually" }), f.bankReconciliationMethod)} />
      </Field>
      <SectionTitle>Settlement account per method</SectionTitle>
      {PAY_METHODS.map((m) => (
        <Field key={m.value} label={m.label} hint="Leave empty to use the default cash or bank account.">
          <Select
            value={methodMap[m.value] ?? ""}
            onChange={(v) => setMethodMap((map) => ({ ...map, [m.value]: v }))}
            options={[{ value: "", label: "Use the default" }, ...assetOptions]}
          />
        </Field>
      ))}
    </SectionPanel>
  );
}

type Sequence = {
  id: string;
  documentType: string;
  prefix: string | null;
  includeYear: boolean;
  includeMonth: boolean;
  includeBranch: boolean;
  sequenceLength: number;
  startingNumber: number;
  nextNumber: number;
  resetFrequency: "NEVER" | "YEARLY" | "MONTHLY";
};

function previewNumber(s: Pick<Sequence, "prefix" | "includeYear" | "includeMonth" | "includeBranch" | "sequenceLength" | "nextNumber">) {
  const now = new Date();
  const parts = [s.prefix || "DOC"];
  if (s.includeYear) parts.push(String(now.getUTCFullYear()));
  if (s.includeMonth) parts.push(String(now.getUTCMonth() + 1).padStart(2, "0"));
  if (s.includeBranch) parts.push("HQ");
  parts.push(String(Math.max(1, s.nextNumber)).padStart(Math.max(1, s.sequenceLength), "0"));
  return parts.join("-");
}

export function NumberingForm({ sectionKey, status, onSaved }: SectionProps) {
  const { can, api } = useSession();
  const { toast } = useFeedback();
  const sequences = useResource<Sequence[]>(`${API}/numbering`);
  const [editing, setEditing] = useState<Sequence | null>(null);
  const [ensuring, setEnsuring] = useState(false);

  async function ensure() {
    setEnsuring(true);
    try {
      await api(`${API}/numbering/ensure`, { method: "POST" });
      toast("Standard number sequences created");
      sequences.reload();
      onSaved();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setEnsuring(false);
    }
  }

  return (
    <SectionPanel title="Document numbering" description="Prefix, date parts and counter length for each document type." sectionKey={sectionKey} status={status} onApproved={onSaved}>
      <Loadable resource={sequences}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState
              title="No number sequences yet"
              body="Create the standard sequences, then adjust their format."
              action={
                can("setup:prepare") && (
                  <button type="button" className="btn btn-primary" disabled={ensuring} onClick={() => void ensure()}>
                    {ensuring ? "Creating…" : "Create standard sequences"}
                  </button>
                )
              }
            />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Document</th>
                  <th>Next number</th>
                  <th>Resets</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {[...rows]
                  .sort((a, b) => a.documentType.localeCompare(b.documentType))
                  .map((s) => (
                    <tr key={s.id}>
                      <td>{humanize(s.documentType)}</td>
                      <td className="mono">{previewNumber(s)}</td>
                      <td>{humanize(s.resetFrequency)}</td>
                      <td className="num">
                        {can("setup:prepare") && (
                          <button type="button" className="btn btn-sm" onClick={() => setEditing(s)}>
                            Edit
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )
        }
      </Loadable>
      {editing && (
        <SequenceDrawer
          sequence={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            sequences.reload();
            onSaved();
          }}
        />
      )}
    </SectionPanel>
  );
}

function SequenceDrawer({ sequence, onClose, onSaved }: { sequence: Sequence; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const [prefix, setPrefix] = useState(sequence.prefix ?? "");
  const [includeYear, setIncludeYear] = useState(sequence.includeYear);
  const [includeMonth, setIncludeMonth] = useState(sequence.includeMonth);
  const [includeBranch, setIncludeBranch] = useState(sequence.includeBranch);
  const [length, setLength] = useState(String(sequence.sequenceLength));
  const [reset, setReset] = useState<string>(sequence.resetFrequency);
  const { busy, error, setError, run } = useSubmit(onSaved);
  const sequenceLength = Number(length);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (includeMonth && !includeYear) return setError("Include the year when the month is included.");
    if (reset === "YEARLY" && !includeYear) return setError("A yearly reset needs the year in the number, or numbers would repeat.");
    if (reset === "MONTHLY" && !(includeYear && includeMonth)) return setError("A monthly reset needs the year and month in the number.");
    if (!(Number.isInteger(sequenceLength) && sequenceLength >= 3 && sequenceLength <= 10)) return setError("Counter length must be between 3 and 10 digits.");
    void run(async () => {
      await put(api, `/numbering/${encodeURIComponent(sequence.documentType)}`, {
        prefix: prefix.trim(),
        includeYear,
        includeMonth,
        includeBranch,
        sequenceLength,
        resetFrequency: reset,
      });
      return `${humanize(sequence.documentType)} numbering saved`;
    });
  }

  return (
    <Drawer title={`${humanize(sequence.documentType)} numbering`} onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Save" formId="sequence-form" />}>
      <FormError message={error} />
      <form id="sequence-form" onSubmit={submit} className="form-grid">
        <Text label="Prefix" required value={prefix} onChange={(v) => setPrefix(v.toUpperCase())} maxLength={10} />
        <Text label="Counter digits" type="number" required value={length} onChange={setLength} />
        <Field label="Counter resets" className="span-2">
          <Select value={reset} onChange={setReset} options={options(["NEVER", "YEARLY", "MONTHLY"], { NEVER: "Never", YEARLY: "Every year", MONTHLY: "Every month" })} />
        </Field>
        <Check label="Include the year" checked={includeYear} onChange={setIncludeYear} />
        <Check label="Include the month" checked={includeMonth} onChange={setIncludeMonth} />
        <Check label="Include the branch code" checked={includeBranch} onChange={setIncludeBranch} />
        <div className="span-2 notice info">
          Next number will look like <strong className="mono">{previewNumber({ prefix, includeYear, includeMonth, includeBranch, sequenceLength: sequenceLength || 1, nextNumber: sequence.nextNumber })}</strong>
        </div>
      </form>
    </Drawer>
  );
}

const ERP_ROLES = options(["ACCOUNTANT", "BRANCH_MANAGER", "ADMIN", "SYSTEM_OWNER"]);
const DATE_POLICIES = options(["ALLOW", "REQUIRE_APPROVAL", "BLOCK"], { ALLOW: "Allow", REQUIRE_APPROVAL: "Require approval", BLOCK: "Block" });
const BUDGET_CONTROLS = options(["OFF", "WARN", "BLOCK"], { OFF: "Don't check", WARN: "Post and warn", BLOCK: "Block the posting" });
const GATED_DOCUMENTS = [
  { value: "ApBill", label: "Supplier bills" },
  { value: "TaxAdjustment", label: "Tax adjustments" },
  { value: "FixedAssetImpairment", label: "Fixed-asset impairments" },
];

type Tier = { minAmount: string; levels: string; roles: string[] };

export function ApprovalsForm({ snap, sectionKey, status, onSaved }: SectionProps) {
  const { api } = useSession();
  const { currency } = useCompany();
  const a = snap.approvals;
  const [workflow, setWorkflow] = useState(bool(a, "approvalWorkflowEnabled", true));
  const [autoPost, setAutoPost] = useState(bool(a, "automaticPostingEnabled", false));
  const [manualPost, setManualPost] = useState(bool(a, "manualPostingRequired", true));
  const [differentPoster, setDifferentPoster] = useState(bool(a, "requireDifferentPoster", true));
  const [periodLock, setPeriodLock] = useState(bool(a, "periodLockEnforcement", true));
  const [docs, setDocs] = useState(bool(a, "supportingDocumentRequired", false));
  const [levels, setLevels] = useState(str(a, "approvalLevels", "1"));
  const [backdated, setBackdated] = useState(str(a, "backdatedTransactionPolicy", "REQUIRE_APPROVAL"));
  const [futureDated, setFutureDated] = useState(str(a, "futureDatedTransactionPolicy", "ALLOW"));
  const [budgetControl, setBudgetControl] = useState(str(a, "budgetControl", "OFF"));
  const [closeApproval, setCloseApproval] = useState(bool(a, "closeApprovalRequired", false));
  const [requiredFor, setRequiredFor] = useState<string[]>(Array.isArray(a?.approvalRequiredFor) ? (a.approvalRequiredFor as string[]) : []);
  const savedTiers = Array.isArray(a?.amountBasedApprovalLimits) ? (a.amountBasedApprovalLimits as Array<{ minAmount: number; levels: number; roles?: string[] }>) : null;
  const [useTiers, setUseTiers] = useState(Boolean(savedTiers?.length));
  const [tiers, setTiers] = useState<Tier[]>(
    savedTiers?.length
      ? savedTiers.map((t) => ({ minAmount: amount(t.minAmount), levels: String(t.levels), roles: t.roles ?? [] }))
      : [{ minAmount: "0", levels: "1", roles: [] }],
  );
  const { busy, error, setError, run } = useSubmit(onSaved);

  function updateTier(i: number, patch: Partial<Tier>) {
    setTiers((ts) => ts.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const approvalLevels = Number(levels);
    let limits: Array<{ minAmount: number; levels: number; roles?: string[] }> | null = null;
    if (useTiers) {
      limits = [];
      for (const [i, t] of tiers.entries()) {
        const minAmount = parseAmount(t.minAmount);
        const n = Number(t.levels);
        if (!(minAmount >= 0)) return setError(`Tier ${i + 1}: enter a starting amount of zero or more.`);
        if (!(Number.isInteger(n) && n >= 0 && n <= 5)) return setError(`Tier ${i + 1}: approvals must be between 0 and 5.`);
        const roles = Array.from({ length: n }, (_, level) => t.roles[level] ?? "");
        if (roles.some(Boolean) && !roles.every(Boolean)) return setError(`Tier ${i + 1}: choose a role for every approval, or leave them all as any approver.`);
        limits.push({ minAmount, levels: n, ...(roles.length && roles.every(Boolean) ? { roles } : {}) });
      }
      if (new Set(limits.map((l) => l.minAmount)).size !== limits.length) return setError("Each tier needs a different starting amount.");
      limits.sort((x, y) => x.minAmount - y.minAmount);
    }
    void run(async () => {
      await put(api, "/approvals", {
        approvalWorkflowEnabled: workflow,
        automaticPostingEnabled: autoPost,
        manualPostingRequired: manualPost,
        requireDifferentPoster: differentPoster,
        periodLockEnforcement: periodLock,
        supportingDocumentRequired: docs,
        approvalLevels,
        amountBasedApprovalLimits: limits,
        backdatedTransactionPolicy: backdated,
        futureDatedTransactionPolicy: futureDated,
        approvalRequiredFor: requiredFor,
        budgetControl,
        closeApprovalRequired: closeApproval,
      });
      return "Approval and posting controls saved";
    });
  }

  return (
    <SectionPanel title="Approvals and posting controls" description="Who must approve manual journals before they post, and which dates are allowed." sectionKey={sectionKey} status={status} formId="setup-approvals" busy={busy} error={error} onSubmit={submit} onApproved={onSaved}>
      <Check label="Manual journals need approval before posting" checked={workflow} onChange={setWorkflow} />
      {workflow && !useTiers && (
        <Field label="Approvals needed" hint="Applies to every manual journal.">
          <Select value={levels} onChange={setLevels} options={["1", "2", "3", "4", "5"].map((n) => ({ value: n, label: n === "1" ? "1 approval" : `${n} approvals` }))} />
        </Field>
      )}
      {workflow && (
        <>
          <Check
            label="Set approvals by amount"
            checked={useTiers}
            onChange={setUseTiers}
            hint="The tier with the highest starting amount at or below the journal total decides how many approvals are needed. Journals below every tier need none."
          />
          {useTiers && (
            <div className="span-2">
              <table className="table lines-table">
                <thead>
                  <tr>
                    <th style={{ width: 170 }}>From ({currency})</th>
                    <th style={{ width: 120 }}>Approvals</th>
                    <th>Role for each approval</th>
                    <th style={{ width: 40 }} />
                  </tr>
                </thead>
                <tbody>
                  {tiers.map((t, i) => {
                    const n = Math.max(0, Math.min(5, Number(t.levels) || 0));
                    return (
                      <tr key={i}>
                        <td>
                          <MoneyInput value={t.minAmount} onChange={(v) => updateTier(i, { minAmount: v })} aria-label={`Starting amount for tier ${i + 1}`} />
                        </td>
                        <td>
                          <Select value={t.levels} onChange={(v) => updateTier(i, { levels: v })} options={["0", "1", "2", "3", "4", "5"].map((x) => ({ value: x, label: x }))} aria-label={`Approvals for tier ${i + 1}`} />
                        </td>
                        <td>
                          {n === 0 ? (
                            <span className="muted small">No approval needed</span>
                          ) : (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                              {Array.from({ length: n }, (_, level) => (
                                <Select
                                  key={level}
                                  style={{ minWidth: 150 }}
                                  value={t.roles[level] ?? ""}
                                  onChange={(v) => {
                                    const roles = [...t.roles];
                                    roles[level] = v;
                                    updateTier(i, { roles });
                                  }}
                                  options={[{ value: "", label: "Any approver" }, ...ERP_ROLES]}
                                  aria-label={`Role for approval ${level + 1} in tier ${i + 1}`}
                                />
                              ))}
                            </div>
                          )}
                        </td>
                        <td>
                          {tiers.length > 1 && (
                            <button type="button" className="icon-button" aria-label={`Remove tier ${i + 1}`} onClick={() => setTiers((ts) => ts.filter((_, idx) => idx !== i))}>
                              ×
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button type="button" className="btn" style={{ marginTop: 8 }} onClick={() => setTiers((ts) => [...ts, { minAmount: "", levels: "1", roles: [] }])}>
                <Plus size={16} aria-hidden="true" />
                Add tier
              </button>
            </div>
          )}
          <SectionTitle>Documents that wait for approval</SectionTitle>
          {GATED_DOCUMENTS.map((d) => (
            <Check
              key={d.value}
              label={d.label}
              checked={requiredFor.includes(d.value)}
              onChange={(on) => setRequiredFor((list) => (on ? [...list, d.value] : list.filter((v) => v !== d.value)))}
            />
          ))}
        </>
      )}
      <SectionTitle>Posting</SectionTitle>
      <Check label="The person who keyed a manual journal can't post it" checked={differentPoster} onChange={setDifferentPoster} />
      <Check label="Post documents from Excel Edge automatically" checked={autoPost} onChange={setAutoPost} />
      <Check label="Manual journals must be posted explicitly" checked={manualPost} onChange={setManualPost} />
      <Check label="Supporting document required on manual journals" checked={docs} onChange={setDocs} />
      <Check label="Block postings into closed or locked periods" checked={periodLock} onChange={setPeriodLock} />
      <Check
        label="Closing a period needs a second person's approval"
        checked={closeApproval}
        onChange={setCloseApproval}
        hint="The close is requested from the period close page and the period closes when someone else with close rights approves it."
      />
      <SectionTitle>Transaction dates</SectionTitle>
      <Field label="Backdated transactions">
        <Select value={backdated} onChange={setBackdated} options={withCurrent(DATE_POLICIES, backdated)} />
      </Field>
      <Field label="Future-dated transactions">
        <Select value={futureDated} onChange={setFutureDated} options={withCurrent(DATE_POLICIES, futureDated)} />
      </Field>
      <SectionTitle>Budget control</SectionTitle>
      <Field
        label="Spending over the active budget"
        hint="Checked when a posting to an expense account takes the month (or year) over its budget line. Blocking applies to manual journals, imports, recurring journals, expenses, supplier bills and bank postings; other module postings only warn."
      >
        <Select value={budgetControl} onChange={setBudgetControl} options={withCurrent(BUDGET_CONTROLS, budgetControl)} />
      </Field>
    </SectionPanel>
  );
}

type OpeningLine = { id: string; accountId: string | null; memo: string | null; debit: string | number; credit: string | number; partyType: string | null; partyRef: string | null };
type OpeningBatch = {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  createdByErpUserId: number | null;
  approvedByErpUserId: number | null;
  approvedAt: string | null;
  postedAt: string | null;
  journalId: string | null;
  lines: OpeningLine[];
};

const BATCH_TONE: Record<string, Tone> = { REQUIRES_REVIEW: "warning", APPROVED: "info", POSTED: "positive", REJECTED: "negative" };

export function OpeningBalancesForm({ snap, sectionKey, status, onSaved }: SectionProps) {
  const { can, api } = useSession();
  const { toast, confirm } = useFeedback();
  const { currency } = useCompany();
  const batches = useResource<OpeningBatch[]>(`${API}/opening-balances`);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<OpeningBatch | null>(null);
  const names = useMemo(() => new Map(snap.accounts.map((a) => [a.id, `${a.code} ${a.name}`])), [snap.accounts]);

  async function act(b: OpeningBatch, action: "approve" | "post") {
    if (action === "post") {
      const ok = await confirm({
        title: `Post ${b.name}?`,
        body: "One opening balance journal is posted to the ledger. It can't be edited afterwards, only reversed.",
        confirmLabel: "Post to ledger",
      });
      if (!ok) return;
    }
    try {
      const res = await api<{ journal?: { journalNumber?: string | null } }>(`${API}/opening-balances/${b.id}/${action}`, { method: "POST" });
      toast(action === "approve" ? `${b.name} approved` : `${b.name} posted${res?.journal?.journalNumber ? ` as ${res.journal.journalNumber}` : ""}`);
      setOpen(null);
      batches.reload();
      onSaved();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  }

  return (
    <SectionPanel
      title="Opening balances"
      description="Balances brought forward from the previous system. Someone other than the preparer approves them before they post."
      sectionKey={sectionKey}
      status={status}
      onApproved={onSaved}
    >
      <Loadable resource={batches}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState title="No opening balances entered" body="Enter balances per account, and per customer or supplier for receivables and payables." />
          ) : (
            <table className="table">
              <thead>
                <tr>
                  <th>Batch</th>
                  <th className="num">Debits ({currency})</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => {
                  const debit = b.lines.reduce((s, l) => s + toNumber(l.debit), 0);
                  return (
                    <tr key={b.id} className="clickable" onClick={() => setOpen(b)}>
                      <td>
                        {b.name}
                        <span className="sub">
                          {b.lines.length} lines · saved {date(b.createdAt)}
                        </span>
                      </td>
                      <td className="num">{amount(debit)}</td>
                      <td>
                        <Badge tone={BATCH_TONE[b.status] ?? "neutral"}>{humanize(b.status)}</Badge>
                      </td>
                      <td className="num nowrap" onClick={(e) => e.stopPropagation()}>
                        {can("setup:approve") && b.status === "REQUIRES_REVIEW" && (
                          <button type="button" className="btn btn-sm" onClick={() => void act(b, "approve")}>
                            Approve
                          </button>
                        )}
                        {can("setup:approve") && b.status === "APPROVED" && (
                          <button type="button" className="btn btn-sm btn-primary" onClick={() => void act(b, "post")}>
                            Post
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )
        }
      </Loadable>
      {can("setup:prepare") && (
        <div style={{ marginTop: 14 }}>
          <button type="button" className="btn" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden="true" />
            Enter opening balances
          </button>
        </div>
      )}
      {creating && (
        <OpeningDrawer
          snap={snap}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            batches.reload();
            onSaved();
          }}
        />
      )}
      {open && (
        <Drawer title={open.name} subtitle={`${humanize(open.status)} · saved ${date(open.createdAt)}`} wide onClose={() => setOpen(null)}>
          <table className="table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Party</th>
                <th className="num">Debit</th>
                <th className="num">Credit</th>
              </tr>
            </thead>
            <tbody>
              {open.lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.accountId ? names.get(l.accountId) ?? l.accountId : "—"}
                    {l.memo && <span className="sub">{l.memo}</span>}
                  </td>
                  <td>{l.partyType ? `${humanize(l.partyType)} ${l.partyRef ?? ""}` : "—"}</td>
                  <td className="num">{toNumber(l.debit) ? amount(l.debit) : ""}</td>
                  <td className="num">{toNumber(l.credit) ? amount(l.credit) : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {open.approvedAt && <p className="muted small" style={{ marginTop: 12 }}>Approved {date(open.approvedAt)}</p>}
          {open.postedAt && <p className="muted small">Posted {date(open.postedAt)}</p>}
        </Drawer>
      )}
    </SectionPanel>
  );
}

type DraftLine = { accountId: string; party: string; memo: string; debit: string; credit: string };
const EMPTY_LINE: DraftLine = { accountId: "", party: "", memo: "", debit: "", credit: "" };

function OpeningDrawer({ snap, onClose, onSaved }: { snap: FullSnapshot; onClose: () => void; onSaved: () => void }) {
  const { can, api } = useSession();
  const { currency } = useCompany();
  const customers = useResource<Customer[]>(can("ar:view") ? "/api/v1/ar/customers" : null);
  const suppliers = useResource<Supplier[]>(can("ap:view") ? "/api/v1/ap/suppliers" : null);
  const [name, setName] = useState("Opening balances");
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY_LINE }, { ...EMPTY_LINE }]);
  const { busy, error, setError, run } = useSubmit(onSaved);

  const accountOpts = useMemo(() => accountOptions(snap.accounts), [snap.accounts]);
  const partyOpts = useMemo<SelectOption[]>(
    () => [
      { value: "", label: "None" },
      ...(customers.data ?? []).map((c) => ({ value: `CUSTOMER:${c.id}`, label: c.name, prefix: c.code, group: "Customers" })),
      ...(suppliers.data ?? []).map((s) => ({ value: `SUPPLIER:${s.id}`, label: s.name, prefix: s.code, group: "Suppliers" })),
    ],
    [customers.data, suppliers.data],
  );

  const totals = lines.reduce(
    (t, l) => ({ debit: t.debit + (parseAmount(l.debit) || 0), credit: t.credit + (parseAmount(l.credit) || 0) }),
    { debit: 0, credit: 0 },
  );
  const difference = Math.round((totals.debit - totals.credit) * 100) / 100;

  function update(i: number, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = lines
      .filter((l) => l.accountId || l.debit || l.credit)
      .map((l) => {
        const [partyType, partyRef] = l.party ? l.party.split(":") : [];
        return {
          accountId: l.accountId || undefined,
          memo: l.memo.trim() || undefined,
          debit: parseAmount(l.debit) || 0,
          credit: parseAmount(l.credit) || 0,
          ...(partyType ? { partyType, partyRef } : {}),
        };
      });
    if (parsed.length === 0) return setError("Add at least one line.");
    if (parsed.some((l) => !l.accountId)) return setError("Every line needs an account.");
    if (parsed.some((l) => (l.debit > 0) === (l.credit > 0))) return setError("Each line needs either a debit or a credit.");
    if (difference !== 0) return setError(`Debits and credits differ by ${amount(Math.abs(difference))}. Opening balances must balance.`);
    void run(async () => {
      await put(api, "/opening-balances", { name: name.trim(), lines: parsed }, "POST");
      return "Opening balances saved for review";
    });
  }

  return (
    <Drawer title="Enter opening balances" subtitle={`Amounts in ${currency}`} wide onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Save for review" formId="opening-form" />}>
      <FormError message={error} />
      <form id="opening-form" onSubmit={submit}>
        <Text label="Batch name" required value={name} onChange={setName} />
        <table className="table lines-table" style={{ marginTop: 14 }}>
          <thead>
            <tr>
              <th>Account</th>
              <th style={{ width: 200 }}>Customer or supplier</th>
              <th className="num" style={{ width: 130 }}>
                Debit
              </th>
              <th className="num" style={{ width: 130 }}>
                Credit
              </th>
              <th style={{ width: 36 }} />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td>
                  <Select value={l.accountId} onChange={(v) => update(i, { accountId: v })} options={accountOpts} placeholder="Choose an account" aria-label={`Account for line ${i + 1}`} />
                  <input className="input" style={{ marginTop: 6 }} value={l.memo} onChange={(e) => update(i, { memo: e.target.value })} placeholder="Memo (optional)" aria-label={`Memo for line ${i + 1}`} />
                </td>
                <td>
                  <Select value={l.party} onChange={(v) => update(i, { party: v })} options={partyOpts} placeholder="None" aria-label={`Customer or supplier for line ${i + 1}`} />
                </td>
                <td>
                  <MoneyInput value={l.debit} onChange={(v) => update(i, { debit: v, credit: v ? "" : l.credit })} aria-label={`Debit for line ${i + 1}`} />
                </td>
                <td>
                  <MoneyInput value={l.credit} onChange={(v) => update(i, { credit: v, debit: v ? "" : l.debit })} aria-label={`Credit for line ${i + 1}`} />
                </td>
                <td>
                  {lines.length > 1 && (
                    <button type="button" className="icon-button" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={2}>Total</td>
              <td className="num">{amount(totals.debit)}</td>
              <td className="num">{amount(totals.credit)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        <div className="filter-bar" style={{ marginTop: 8 }}>
          <button type="button" className="btn" onClick={() => setLines((ls) => [...ls, { ...EMPTY_LINE }])}>
            <Plus size={16} aria-hidden="true" />
            Add line
          </button>
          <span className="grow" />
          <span className={difference === 0 ? "muted small" : "text-negative strong small"}>
            {difference === 0 ? "Balanced" : `Out of balance by ${amount(Math.abs(difference))}`}
          </span>
        </div>
        <p className="muted small">Receivable and payable balances should name the customer or supplier so their statements open with the right amount.</p>
      </form>
    </Drawer>
  );
}
