import { SUPPLIER_CATEGORIES } from "@exceledge/accounting-domain-web";
import { AlertTriangle, Building2, ChevronDown, CreditCard, FileText, MapPin, User } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { accountOptions } from "../../pages/Accounts";
import { useCompany } from "../../lib/company";
import { amount, humanize, isoDay, toNumber } from "../../lib/format";
import { useSession } from "../../lib/session";
import type { AccountType, ApPaymentMethod, Supplier, SupplierDuplicate, SupplierType } from "../../lib/types";
import { AP_METHODS } from "../ApForms";
import { AttachmentsPanel } from "../AttachmentsPanel";
import { Footer, FormError, MoneyInput, parseAmount, useSubmit } from "../forms";
import { Select } from "../Select";
import { Drawer, Field } from "../ui";

export const SUPPLIER_TYPES: Array<{ value: SupplierType; label: string }> = [
  { value: "BUSINESS", label: "Business" },
  { value: "INDIVIDUAL", label: "Individual" },
  { value: "GOVERNMENT", label: "Government body" },
  { value: "NON_PROFIT", label: "Non-profit" },
];

const TERMS = [
  { value: "0", label: "Due on receipt" },
  { value: "7", label: "Net 7" },
  { value: "15", label: "Net 15" },
  { value: "30", label: "Net 30" },
  { value: "45", label: "Net 45" },
  { value: "60", label: "Net 60" },
  { value: "90", label: "Net 90" },
];

const CURRENCIES = ["RWF", "USD", "EUR", "GBP", "KES", "UGX", "TZS"];
const EXPENSE_TYPES: AccountType[] = ["COST_OF_SALES", "EXPENSE", "OTHER_EXPENSE", "ASSET"];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Draft = {
  name: string;
  companyName: string;
  firstName: string;
  lastName: string;
  supplierType: SupplierType;
  category: string;
  contactPerson: string;
  status: Supplier["status"];
  email: string;
  telephone: string;
  mobile: string;
  website: string;
  alternateContact: string;
  tin: string;
  vatRegistered: boolean;
  vatNumber: string;
  registrationNumber: string;
  whtRate: string;
  whtCategory: string;
  physicalAddress: string;
  sector: string;
  district: string;
  province: string;
  country: string;
  postalCode: string;
  terms: string;
  preferredPaymentMethod: string;
  bankName: string;
  bankAccountHolder: string;
  bankAccountNumber: string;
  currency: string;
  apAccountId: string;
  defaultExpenseAccountId: string;
  openingBalance: string;
  openingBalanceDate: string;
  creditLimit: string;
  notes: string;
  internalRemarks: string;
};

function draftFrom(s: Supplier | undefined, initialName: string, currency: string): Draft {
  return {
    name: s?.name ?? initialName,
    companyName: s?.companyName ?? "",
    firstName: s?.firstName ?? "",
    lastName: s?.lastName ?? "",
    supplierType: s?.supplierType ?? "BUSINESS",
    category: s?.category ?? "",
    contactPerson: s?.contactPerson ?? "",
    status: s?.status ?? "ACTIVE",
    email: s?.email ?? "",
    telephone: s?.telephone ?? "",
    mobile: s?.mobile ?? "",
    website: s?.website ?? "",
    alternateContact: s?.alternateContact ?? "",
    tin: s?.tin ?? "",
    vatRegistered: s?.vatRegistered ?? false,
    vatNumber: s?.vatNumber ?? "",
    registrationNumber: s?.registrationNumber ?? "",
    whtRate: s && toNumber(s.whtRate) ? String(toNumber(s.whtRate)) : "",
    whtCategory: s?.whtCategory ?? "",
    physicalAddress: s?.physicalAddress ?? "",
    sector: s?.sector ?? "",
    district: s?.district ?? "",
    province: s?.province ?? "",
    country: s?.country ?? "",
    postalCode: s?.postalCode ?? "",
    terms: String(s?.creditPeriodDays ?? 30),
    preferredPaymentMethod: s?.preferredPaymentMethod ?? "",
    bankName: s?.bankName ?? "",
    bankAccountHolder: s?.bankAccountHolder ?? "",
    bankAccountNumber: s?.bankAccountNumber ?? "",
    currency: s?.currency ?? currency,
    apAccountId: s?.apAccountId ?? "",
    defaultExpenseAccountId: s?.defaultExpenseAccountId ?? "",
    openingBalance: "",
    openingBalanceDate: isoDay(),
    creditLimit: s && toNumber(s.creditLimit) > 0 ? amount(s.creditLimit) : "",
    notes: s?.notes ?? "",
    internalRemarks: s?.internalRemarks ?? "",
  };
}

type Errors = Partial<Record<keyof Draft, string>>;

function validate(d: Draft, editing: boolean): Errors {
  const e: Errors = {};
  if (!d.name.trim()) e.name = "Display name is required";
  if (d.email.trim() && !EMAIL.test(d.email.trim())) e.email = "Enter a valid email address";
  if (d.tin && !/^\d{9}$/.test(d.tin)) e.tin = "TIN must be 9 digits";
  if (d.website.trim() && !/^(https?:\/\/)?[^\s.]+\.[^\s]+$/i.test(d.website.trim())) e.website = "Enter a web address like example.com";
  const terms = Number(d.terms);
  if (!Number.isInteger(terms) || terms < 0 || terms > 365) e.terms = "Days must be between 0 and 365";
  if (d.whtRate) {
    const r = Number(d.whtRate);
    if (!Number.isFinite(r) || r < 0 || r >= 100) e.whtRate = "Enter a rate from 0 to 99.99";
  }
  const limit = parseAmount(d.creditLimit);
  if (d.creditLimit && (!Number.isFinite(limit) || limit < 0)) e.creditLimit = "Enter an amount of zero or more";
  if (d.bankAccountNumber && !/^[\d\s-]{4,40}$/.test(d.bankAccountNumber)) e.bankAccountNumber = "Use digits, spaces or dashes";
  if (!editing && d.openingBalance) {
    const ob = parseAmount(d.openingBalance);
    if (!Number.isFinite(ob) || ob < 0) e.openingBalance = "Enter an amount of zero or more";
    if (!d.openingBalanceDate) e.openingBalanceDate = "Pick the date the balance was owed from";
    else if (d.openingBalanceDate > isoDay()) e.openingBalanceDate = "Can't be in the future";
  }
  return e;
}

/** Collapsible group in the form. Opens itself when it holds an error so nothing invalid is hidden. */
function Section({
  title,
  icon: Icon,
  summary,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon: typeof User;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className={`cf-section ${open ? "open" : ""}`}>
      <button type="button" className="cf-section-head" onClick={onToggle} aria-expanded={open}>
        <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
        <span className="cf-section-title">{title}</span>
        {!open && summary && <span className="cf-section-summary">{summary}</span>}
        <ChevronDown size={16} className="cf-section-chevron" aria-hidden="true" />
      </button>
      {open && <div className="cf-section-body">{children}</div>}
    </section>
  );
}

type SectionId = "contact" | "tax" | "address" | "payment" | "more";

const SECTION_FIELDS: Record<SectionId, Array<keyof Draft>> = {
  contact: ["email", "telephone", "mobile", "website", "alternateContact"],
  tax: ["tin", "vatNumber", "registrationNumber", "whtRate", "whtCategory"],
  address: ["physicalAddress", "sector", "district", "province", "country", "postalCode"],
  payment: ["terms", "preferredPaymentMethod", "bankName", "bankAccountHolder", "bankAccountNumber", "currency", "openingBalance", "openingBalanceDate"],
  more: ["creditLimit", "notes", "internalRemarks"],
};

/**
 * The one supplier form, for adding and editing, grouped like the QuickBooks vendor form.
 * Saves through POST/PATCH /api/v1/ap/suppliers; the server repeats every check and refuses duplicate names and TINs.
 */
export function SupplierFormDrawer({
  supplier,
  initialName,
  onClose,
  onSaved,
}: {
  supplier?: Supplier;
  initialName?: string;
  onClose: () => void;
  onSaved: (s: Supplier) => void;
}) {
  const { api } = useSession();
  const { currency: companyCurrency, accounts } = useCompany();
  const editing = Boolean(supplier);
  const [d, setD] = useState<Draft>(() => draftFrom(supplier, initialName ?? "", companyCurrency));
  const [touched, setTouched] = useState<Partial<Record<keyof Draft, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [nameEdited, setNameEdited] = useState(Boolean(supplier || initialName));
  const [open, setOpen] = useState<Record<SectionId, boolean>>(() => ({
    contact: true,
    tax: Boolean(supplier?.tin || supplier?.vatRegistered),
    address: Boolean(supplier?.physicalAddress || supplier?.district),
    payment: !editing,
    more: Boolean(supplier?.notes || supplier?.internalRemarks),
  }));
  const [dupes, setDupes] = useState<SupplierDuplicate[]>([]);
  const { busy, error, setError, run } = useSubmit();

  const errors = useMemo(() => validate(d, editing), [d, editing]);
  const show = (k: keyof Draft) => (submitted || touched[k] ? errors[k] : undefined);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const blur = (k: keyof Draft) => () => setTouched((t) => ({ ...t, [k]: true }));

  // Like QuickBooks: the display name follows company or first/last name until the user types their own.
  function setNamePart(k: "companyName" | "firstName" | "lastName", v: string) {
    setD((x) => {
      const next = { ...x, [k]: v };
      if (!nameEdited) next.name = next.companyName.trim() || [next.firstName, next.lastName].map((p) => p.trim()).filter(Boolean).join(" ");
      return next;
    });
  }

  const apOptions = useMemo(
    () => [{ value: "", label: "Company default payables account" }, ...accountOptions(accounts.filter((a) => a.isActive && a.type === "LIABILITY"))],
    [accounts],
  );
  const expenseOptions = useMemo(
    () => [{ value: "", label: "Company default purchases account" }, ...accountOptions(accounts.filter((a) => a.isActive && EXPENSE_TYPES.includes(a.type)))],
    [accounts],
  );

  // Look for likely duplicates as the identifying fields settle.
  const dupeKey = `${d.name.trim()}|${d.tin}|${d.email.trim()}|${d.telephone || d.mobile}`;
  useEffect(() => {
    const [name, tin, email, phone] = dupeKey.split("|");
    if (!name && !tin && !email && !phone) {
      setDupes([]);
      return;
    }
    let live = true;
    const t = window.setTimeout(() => {
      const q = new URLSearchParams();
      if (name) q.set("name", name);
      if (/^\d{9}$/.test(tin)) q.set("tin", tin);
      if (EMAIL.test(email)) q.set("email", email);
      if (phone.replace(/\D/g, "").length >= 6) q.set("phone", phone);
      if (supplier) q.set("exceptId", supplier.id);
      api<SupplierDuplicate[]>(`/api/v1/ap/suppliers/duplicates?${q.toString()}`)
        .then((rows) => live && setDupes(rows))
        .catch(() => live && setDupes([]));
    }, 350);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [dupeKey, api, supplier]);

  const blocking = dupes.find((x) => x.blocking);

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    const bad = Object.keys(errors) as Array<keyof Draft>;
    if (bad.length) {
      setOpen((o) => {
        const next = { ...o };
        for (const [id, fields] of Object.entries(SECTION_FIELDS) as Array<[SectionId, Array<keyof Draft>]>) if (fields.some((f) => bad.includes(f))) next[id] = true;
        return next;
      });
      return;
    }
    if (blocking) {
      setError(blocking.matched.includes("tin") ? `TIN ${d.tin} already belongs to ${blocking.name}.` : `A supplier named "${blocking.name}" already exists.`);
      return;
    }
    const empty = editing ? null : undefined;
    const text = (v: string) => v.trim() || empty;
    const limit = parseAmount(d.creditLimit);
    const body: Record<string, unknown> = {
      name: d.name.trim(),
      companyName: text(d.companyName),
      firstName: text(d.firstName),
      lastName: text(d.lastName),
      supplierType: d.supplierType,
      category: d.category || empty,
      contactPerson: text(d.contactPerson),
      email: text(d.email),
      telephone: text(d.telephone),
      mobile: text(d.mobile),
      website: text(d.website),
      alternateContact: text(d.alternateContact),
      tin: d.tin || empty,
      vatRegistered: d.vatRegistered,
      vatNumber: d.vatRegistered ? text(d.vatNumber) : empty,
      registrationNumber: text(d.registrationNumber),
      whtRate: d.whtRate ? Number(d.whtRate) : 0,
      whtCategory: text(d.whtCategory),
      physicalAddress: text(d.physicalAddress),
      sector: text(d.sector),
      district: text(d.district),
      province: text(d.province),
      country: text(d.country),
      postalCode: text(d.postalCode),
      creditPeriodDays: Number(d.terms),
      paymentTerms: TERMS.find((t) => t.value === d.terms)?.label ?? `Net ${d.terms}`,
      preferredPaymentMethod: (d.preferredPaymentMethod as ApPaymentMethod) || empty,
      bankName: text(d.bankName),
      bankAccountHolder: text(d.bankAccountHolder),
      bankAccountNumber: text(d.bankAccountNumber),
      apAccountId: d.apAccountId || empty,
      defaultExpenseAccountId: d.defaultExpenseAccountId || empty,
      creditLimit: Number.isFinite(limit) ? limit : 0,
      notes: text(d.notes),
      internalRemarks: text(d.internalRemarks),
    };
    if (editing) {
      body.status = d.status;
    } else {
      body.currency = d.currency;
      const ob = parseAmount(d.openingBalance);
      if (Number.isFinite(ob) && ob > 0) {
        body.openingBalance = ob;
        body.openingBalanceDate = d.openingBalanceDate;
      }
    }
    void run(async () => {
      const saved = editing
        ? await api<Supplier>(`/api/v1/ap/suppliers/${supplier!.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : await api<Supplier>("/api/v1/ap/suppliers", { method: "POST", body: JSON.stringify(body) });
      onSaved(saved);
      return editing ? `${saved.name} updated` : `${saved.name} added as ${saved.code}`;
    });
  }

  const toggle = (id: SectionId) => () => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const termsLabel = TERMS.find((t) => t.value === d.terms)?.label ?? `Net ${d.terms}`;
  const ccy = editing ? supplier!.currency : d.currency;

  return (
    <Drawer
      title={editing ? `Edit ${supplier!.name}` : "New supplier"}
      subtitle={editing ? `${supplier!.code} · changes are recorded in the activity log` : "Only the display name is required. Add the rest now or later."}
      wide
      onClose={onClose}
      footer={<Footer onCancel={onClose} busy={busy} label={editing ? "Save changes" : "Save supplier"} formId="supplier-form" />}
    >
      <form id="supplier-form" className="cf" onSubmit={submit} noValidate>
        <FormError message={error} />

        {dupes.length > 0 && (
          <div className={`cf-dupes ${blocking ? "blocking" : ""}`} role="status">
            <AlertTriangle size={16} aria-hidden="true" />
            <div>
              <strong>{blocking ? "This supplier already exists" : "Possible duplicate"}</strong>
              <ul>
                {dupes.map((x) => (
                  <li key={x.id}>
                    <a href={`/suppliers/${x.id}`} target="_blank" rel="noreferrer">
                      {x.name}
                    </a>{" "}
                    <span className="muted">
                      {x.code} · same {x.matched.join(" and ")}
                      {x.status === "INACTIVE" ? " · inactive" : ""}
                    </span>
                  </li>
                ))}
              </ul>
              {blocking && <p className="small muted">Use a different display name or TIN, or open the existing supplier.</p>}
            </div>
          </div>
        )}

        <div className="cf-basic">
          <div className="form-grid">
            <Field label="Company name" hint="Legal or trading name">
              <input className="input" value={d.companyName} onChange={(e) => setNamePart("companyName", e.target.value)} maxLength={200} autoComplete="off" />
            </Field>
            <Field label="Supplier type">
              <Select value={d.supplierType} onChange={(v) => set("supplierType", v as SupplierType)} searchable={false} options={SUPPLIER_TYPES} />
            </Field>
            <Field label="First name">
              <input className="input" value={d.firstName} onChange={(e) => setNamePart("firstName", e.target.value)} maxLength={100} />
            </Field>
            <Field label="Last name">
              <input className="input" value={d.lastName} onChange={(e) => setNamePart("lastName", e.target.value)} maxLength={100} />
            </Field>
            <Field label="Supplier display name" required error={show("name")} className="span-2" hint="Shown on bills, purchase orders and payments">
              <input
                className="input"
                value={d.name}
                onChange={(e) => {
                  setNameEdited(true);
                  set("name", e.target.value);
                }}
                onBlur={blur("name")}
                autoComplete="off"
                maxLength={200}
              />
            </Field>
            <Field label="Category">
              <Select
                value={d.category}
                onChange={(v) => set("category", v)}
                searchable={false}
                options={[{ value: "", label: "None" }, ...SUPPLIER_CATEGORIES.map((c) => ({ value: c, label: humanize(c) })), ...(d.category && !(SUPPLIER_CATEGORIES as readonly string[]).includes(d.category) ? [{ value: d.category, label: humanize(d.category) }] : [])]}
              />
            </Field>
            <Field label="Contact person">
              <input className="input" value={d.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} maxLength={200} />
            </Field>
            {editing && (
              <Field label="Status" hint={Math.abs(toNumber(supplier!.balance)) > 0.005 ? "Pay or credit the balance before making the supplier inactive" : "Inactive suppliers are hidden from new transactions"}>
                <Select
                  value={d.status}
                  onChange={(v) => set("status", v as Draft["status"])}
                  searchable={false}
                  options={[
                    { value: "ACTIVE", label: "Active" },
                    { value: "INACTIVE", label: "Inactive" },
                  ]}
                />
              </Field>
            )}
          </div>
        </div>

        <Section title="Contact" icon={User} open={open.contact} onToggle={toggle("contact")} summary={[d.email, d.telephone || d.mobile].filter(Boolean).join(" · ")}>
          <div className="form-grid">
            <Field label="Email" error={show("email")}>
              <input className="input" type="email" value={d.email} onChange={(e) => set("email", e.target.value)} onBlur={blur("email")} autoComplete="off" />
            </Field>
            <Field label="Phone">
              <input className="input" type="tel" value={d.telephone} onChange={(e) => set("telephone", e.target.value)} placeholder="+250 7…" />
            </Field>
            <Field label="Mobile">
              <input className="input" type="tel" value={d.mobile} onChange={(e) => set("mobile", e.target.value)} />
            </Field>
            <Field label="Website" error={show("website")}>
              <input className="input" value={d.website} onChange={(e) => set("website", e.target.value)} onBlur={blur("website")} placeholder="example.com" />
            </Field>
            <Field label="Other contact" className="span-2" hint="Another person, phone or email, e.g. Accounts: +250 788 000 111">
              <input className="input" value={d.alternateContact} onChange={(e) => set("alternateContact", e.target.value)} maxLength={500} />
            </Field>
          </div>
        </Section>

        <Section
          title="Business and tax"
          icon={Building2}
          open={open.tax}
          onToggle={toggle("tax")}
          summary={[d.tin && `TIN ${d.tin}`, d.vatRegistered && "VAT registered", d.whtRate && `WHT ${d.whtRate}%`].filter(Boolean).join(" · ")}
        >
          <div className="form-grid">
            <Field label="TIN" error={show("tin")} hint={editing ? "Locked once the supplier has posted bills" : "9-digit RRA taxpayer number"}>
              <input
                className={`input ${show("tin") ? "invalid" : ""}`}
                value={d.tin}
                onChange={(e) => set("tin", e.target.value.replace(/\D/g, "").slice(0, 9))}
                onBlur={blur("tin")}
                inputMode="numeric"
              />
            </Field>
            <Field label="Business registration number">
              <input className="input" value={d.registrationNumber} onChange={(e) => set("registrationNumber", e.target.value)} maxLength={100} />
            </Field>
            <div className="span-2">
              <label className="check">
                <input type="checkbox" checked={d.vatRegistered} onChange={(e) => set("vatRegistered", e.target.checked)} />
                <span>Registered for VAT: their bills carry input VAT you can claim</span>
              </label>
            </div>
            {d.vatRegistered && (
              <Field label="VAT number" className="span-2">
                <input className="input" value={d.vatNumber} onChange={(e) => set("vatNumber", e.target.value)} maxLength={100} />
              </Field>
            )}
            <Field label="Withholding tax rate (%)" error={show("whtRate")} hint="Withheld from each payment and paid to RRA">
              <input className="input" inputMode="decimal" value={d.whtRate} onChange={(e) => set("whtRate", e.target.value)} onBlur={blur("whtRate")} placeholder="0" />
            </Field>
            <Field label="Withholding category" hint="e.g. Professional services">
              <input className="input" value={d.whtCategory} onChange={(e) => set("whtCategory", e.target.value)} maxLength={200} />
            </Field>
          </div>
        </Section>

        <Section
          title="Address"
          icon={MapPin}
          open={open.address}
          onToggle={toggle("address")}
          summary={[d.physicalAddress, d.district, d.country].filter(Boolean).join(", ")}
        >
          <div className="form-grid">
            <Field label="Street address" className="span-2">
              <input className="input" value={d.physicalAddress} onChange={(e) => set("physicalAddress", e.target.value)} placeholder="KN 5 Rd, building, floor" maxLength={500} />
            </Field>
            <Field label="Sector">
              <input className="input" value={d.sector} onChange={(e) => set("sector", e.target.value)} />
            </Field>
            <Field label="District">
              <input className="input" value={d.district} onChange={(e) => set("district", e.target.value)} />
            </Field>
            <Field label="Province">
              <input className="input" value={d.province} onChange={(e) => set("province", e.target.value)} />
            </Field>
            <Field label="Postal code">
              <input className="input" value={d.postalCode} onChange={(e) => set("postalCode", e.target.value)} maxLength={20} />
            </Field>
            <Field label="Country">
              <input className="input" value={d.country} onChange={(e) => set("country", e.target.value)} placeholder="Rwanda" />
            </Field>
          </div>
        </Section>

        <Section
          title={editing ? "Payment" : "Payment and opening balance"}
          icon={CreditCard}
          open={open.payment}
          onToggle={toggle("payment")}
          summary={[termsLabel, d.preferredPaymentMethod && AP_METHODS.find((m) => m.value === d.preferredPaymentMethod)?.label, d.bankName].filter(Boolean).join(" · ")}
        >
          <div className="form-grid">
            <Field label="Terms" error={show("terms")} hint="Sets the due date on new bills">
              <Select
                value={TERMS.some((t) => t.value === d.terms) ? d.terms : "custom"}
                onChange={(v) => set("terms", v === "custom" ? d.terms : v)}
                searchable={false}
                options={[...TERMS, ...(TERMS.some((t) => t.value === d.terms) ? [] : [{ value: "custom", label: `Net ${d.terms}` }])]}
              />
            </Field>
            <Field label="Preferred payment method">
              <Select value={d.preferredPaymentMethod} onChange={(v) => set("preferredPaymentMethod", v)} searchable={false} options={[{ value: "", label: "None" }, ...AP_METHODS]} />
            </Field>
            <Field label="Bank name">
              <input className="input" value={d.bankName} onChange={(e) => set("bankName", e.target.value)} placeholder="Bank of Kigali" />
            </Field>
            <Field label="Account holder">
              <input className="input" value={d.bankAccountHolder} onChange={(e) => set("bankAccountHolder", e.target.value)} />
            </Field>
            <Field label="Account number" error={show("bankAccountNumber")}>
              <input className="input" value={d.bankAccountNumber} onChange={(e) => set("bankAccountNumber", e.target.value)} onBlur={blur("bankAccountNumber")} inputMode="numeric" />
            </Field>
            <Field label="Currency" hint={editing ? "Fixed once the supplier is created" : "Bills from this supplier default to it"}>
              {editing ? (
                <input className="input" value={supplier!.currency} disabled />
              ) : (
                <Select value={d.currency} onChange={(v) => set("currency", v)} searchable={false} options={[...new Set([companyCurrency, ...CURRENCIES])].map((c) => ({ value: c, label: c }))} />
              )}
            </Field>
            {(() => {
              const locked = editing && Math.abs(toNumber(supplier!.balance)) > 0.005;
              return (
                <Field label="Payables account" hint={locked ? "Locked while the supplier has an open balance" : "Leave on the default unless this supplier is tracked separately"}>
                  <Select value={d.apAccountId} onChange={(v) => set("apAccountId", v)} options={apOptions} disabled={locked} />
                </Field>
              );
            })()}
            <Field label="Default expense account" hint="Pre-filled on new bills">
              <Select value={d.defaultExpenseAccountId} onChange={(v) => set("defaultExpenseAccountId", v)} options={expenseOptions} />
            </Field>
            {editing ? (
              <p className="small muted span-2">
                Opening balance: {ccy} {amount(supplier!.openingBalance ?? 0)}. To change it, post a bill, supplier credit or journal so the books keep the history.
              </p>
            ) : (
              <>
                <Field label={`Opening balance (${ccy})`} error={show("openingBalance")} hint="What you already owed this supplier before using Excel Edge">
                  <MoneyInput value={d.openingBalance} onChange={(v) => set("openingBalance", v)} invalid={Boolean(show("openingBalance"))} />
                </Field>
                <Field label="As of" error={show("openingBalanceDate")}>
                  <input className="input" type="date" max={isoDay()} value={d.openingBalanceDate} onChange={(e) => set("openingBalanceDate", e.target.value)} />
                </Field>
              </>
            )}
          </div>
        </Section>

        <Section
          title="Notes and more"
          icon={FileText}
          open={open.more}
          onToggle={toggle("more")}
          summary={[d.creditLimit && `limit ${d.creditLimit}`, d.notes.split("\n")[0]].filter(Boolean).join(" · ")}
        >
          <div className="form-grid">
            <Field label={`Credit limit (${ccy})`} error={show("creditLimit")} hint="The most this supplier lets you owe. Leave empty for none.">
              <MoneyInput value={d.creditLimit} onChange={(v) => set("creditLimit", v)} invalid={Boolean(show("creditLimit"))} />
            </Field>
            <div />
            <Field label="Notes" className="span-2" hint="General notes about this supplier. Dated notes go on the profile's Notes tab.">
              <textarea className="input" rows={2} value={d.notes} onChange={(e) => set("notes", e.target.value)} maxLength={4000} />
            </Field>
            <Field label="Internal remarks" className="span-2" hint="Kept inside your company; never printed on purchase orders or remittances">
              <textarea className="input" rows={2} value={d.internalRemarks} onChange={(e) => set("internalRemarks", e.target.value)} maxLength={4000} />
            </Field>
          </div>
          {editing ? (
            <AttachmentsPanel entityType="Supplier" entityId={supplier!.id} title="Documents" />
          ) : (
            <p className="small muted">Contracts, bank letters and tax certificates can be attached once the supplier is saved.</p>
          )}
        </Section>
      </form>
    </Drawer>
  );
}
