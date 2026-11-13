import { AlertTriangle, ChevronDown, CreditCard, FileText, MapPin, Receipt, User } from "lucide-react";
import { type FormEvent, type ReactNode, useEffect, useMemo, useState } from "react";
import { CUSTOMER_TYPES, PAYMENT_METHODS } from "../ArForms";
import { Footer, FormError, MoneyInput, parseAmount, useSubmit } from "../forms";
import { Select } from "../Select";
import { Drawer, Field } from "../ui";
import { useCompany } from "../../lib/company";
import { amount, humanize, isoDay, toNumber } from "../../lib/format";
import { useResource, useSession } from "../../lib/session";
import type { ArPaymentMethod, Customer, CustomerDuplicate, CustomerType } from "../../lib/types";

const TERMS = [
  { value: "0", label: "Due on receipt" },
  { value: "7", label: "Net 7" },
  { value: "15", label: "Net 15" },
  { value: "30", label: "Net 30" },
  { value: "45", label: "Net 45" },
  { value: "60", label: "Net 60" },
  { value: "90", label: "Net 90" },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Draft = {
  name: string;
  companyName: string;
  customerType: CustomerType;
  contactPerson: string;
  email: string;
  telephone: string;
  mobile: string;
  website: string;
  physicalAddress: string;
  country: string;
  shippingSame: boolean;
  shippingAddress: string;
  terms: string;
  preferredPaymentMethod: string;
  creditLimit: string;
  creditStatus: Customer["creditStatus"];
  status: Customer["status"];
  tin: string;
  openingBalance: string;
  openingBalanceDate: string;
  notes: string;
  isSub: boolean;
  parentId: string;
  tags: string;
  taxExempt: boolean;
  taxExemptReason: string;
};

function draftFrom(c?: Customer, initialName = ""): Draft {
  return {
    name: c?.name ?? initialName,
    companyName: c?.companyName ?? "",
    customerType: c?.customerType ?? "CREDIT",
    contactPerson: c?.contactPerson ?? "",
    email: c?.email ?? "",
    telephone: c?.telephone ?? "",
    mobile: c?.mobile ?? "",
    website: c?.website ?? "",
    physicalAddress: c?.physicalAddress ?? "",
    country: c?.country ?? "",
    shippingSame: !c?.shippingAddress,
    shippingAddress: c?.shippingAddress ?? "",
    terms: String(c?.creditPeriodDays ?? 30),
    preferredPaymentMethod: c?.preferredPaymentMethod ?? "",
    creditLimit: c && toNumber(c.creditLimit) > 0 ? amount(c.creditLimit) : "",
    creditStatus: c?.creditStatus ?? "GOOD",
    status: c?.status ?? "ACTIVE",
    tin: c?.tin ?? "",
    openingBalance: "",
    openingBalanceDate: isoDay(),
    notes: c?.notes ?? "",
    isSub: Boolean(c?.parentId),
    parentId: c?.parentId ?? "",
    tags: (c?.tags ?? []).join(", "),
    taxExempt: c?.taxExempt ?? false,
    taxExemptReason: c?.taxExemptReason ?? "",
  };
}

type Errors = Partial<Record<keyof Draft, string>>;

function validate(d: Draft, editing: boolean): Errors {
  const e: Errors = {};
  if (!d.name.trim()) e.name = "Display name is required";
  if (d.email.trim() && !EMAIL.test(d.email.trim())) e.email = "Enter a valid email address";
  if (d.tin && !/^\d{9}$/.test(d.tin)) e.tin = "TIN must be 9 digits";
  const limit = parseAmount(d.creditLimit);
  if (d.creditLimit && (!Number.isFinite(limit) || limit < 0)) e.creditLimit = "Enter an amount of zero or more";
  const terms = Number(d.terms);
  if (!Number.isInteger(terms) || terms < 0 || terms > 365) e.terms = "Days must be between 0 and 365";
  if (!editing && d.openingBalance) {
    const ob = parseAmount(d.openingBalance);
    if (!Number.isFinite(ob) || ob < 0) e.openingBalance = "Enter an amount of zero or more";
    if (!d.openingBalanceDate) e.openingBalanceDate = "Pick the date the balance was owed from";
    else if (d.openingBalanceDate > isoDay()) e.openingBalanceDate = "Can't be in the future";
  }
  if (d.isSub && !d.parentId) e.parentId = "Choose the parent customer";
  if (d.taxExempt && !d.taxExemptReason.trim()) e.taxExemptReason = "Say why sales to this customer carry no tax";
  if (d.tags.split(",").filter((t) => t.trim()).length > 10) e.tags = "Use at most 10 tags";
  if (d.website.trim() && !/^(https?:\/\/)?[^\s.]+\.[^\s]+$/i.test(d.website.trim())) e.website = "Enter a web address like example.com";
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

type SectionId = "contact" | "address" | "payment" | "tax" | "notes";

const SECTION_FIELDS: Record<SectionId, Array<keyof Draft>> = {
  contact: ["contactPerson", "email", "telephone", "mobile", "website"],
  address: ["physicalAddress", "country", "shippingAddress"],
  payment: ["terms", "preferredPaymentMethod", "creditLimit"],
  tax: ["tin", "openingBalance", "openingBalanceDate", "taxExemptReason"],
  notes: ["notes", "tags"],
};

/**
 * The one customer form, for adding and editing. Saves through POST/PATCH /api/v1/ar/customers;
 * the server repeats every check and refuses duplicate names and TINs.
 */
export function CustomerFormDrawer({
  customer,
  initialName,
  onClose,
  onSaved,
}: {
  customer?: Customer;
  initialName?: string;
  onClose: () => void;
  onSaved: (c: Customer) => void;
}) {
  const { api } = useSession();
  const { currency } = useCompany();
  const editing = Boolean(customer);
  const [d, setD] = useState<Draft>(() => draftFrom(customer, initialName));
  const [touched, setTouched] = useState<Partial<Record<keyof Draft, boolean>>>({});
  const [submitted, setSubmitted] = useState(false);
  const [open, setOpen] = useState<Record<SectionId, boolean>>(() => ({
    contact: true,
    address: Boolean(customer?.physicalAddress || customer?.shippingAddress),
    payment: !editing,
    tax: false,
    notes: Boolean(customer?.notes || customer?.tags?.length),
  }));
  const allCustomers = useResource<Customer[]>(d.isSub ? "/api/v1/ar/customers" : null);
  const parentOptions = (allCustomers.data ?? []).filter((x) => x.id !== customer?.id && x.status === "ACTIVE").map((x) => ({ value: x.id, label: x.name, hint: x.code }));
  const [dupes, setDupes] = useState<CustomerDuplicate[]>([]);
  const { busy, error, setError, run } = useSubmit();

  const errors = useMemo(() => validate(d, editing), [d, editing]);
  const show = (k: keyof Draft) => (submitted || touched[k] ? errors[k] : undefined);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const blur = (k: keyof Draft) => () => setTouched((t) => ({ ...t, [k]: true }));

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
      if (customer) q.set("exceptId", customer.id);
      api<CustomerDuplicate[]>(`/api/v1/ar/customers/duplicates?${q.toString()}`)
        .then((rows) => live && setDupes(rows))
        .catch(() => live && setDupes([]));
    }, 350);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [dupeKey, api, customer]);

  const blocking = dupes.find((x) => x.blocking);

  function submit(e: FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    const bad = Object.keys(errors) as Array<keyof Draft>;
    if (bad.length) {
      // Open any section hiding an invalid field.
      setOpen((o) => {
        const next = { ...o };
        for (const [id, fields] of Object.entries(SECTION_FIELDS) as Array<[SectionId, Array<keyof Draft>]>) if (fields.some((f) => bad.includes(f))) next[id] = true;
        return next;
      });
      return;
    }
    if (blocking) {
      setError(blocking.matched.includes("tin") ? `TIN ${d.tin} already belongs to ${blocking.name}.` : `A customer named "${blocking.name}" already exists.`);
      return;
    }
    const empty = editing ? null : undefined;
    const text = (v: string) => v.trim() || empty;
    const limit = parseAmount(d.creditLimit);
    const body: Record<string, unknown> = {
      name: d.name.trim(),
      companyName: text(d.companyName),
      customerType: d.customerType,
      contactPerson: text(d.contactPerson),
      email: text(d.email),
      telephone: text(d.telephone),
      mobile: text(d.mobile),
      website: text(d.website),
      physicalAddress: text(d.physicalAddress),
      country: text(d.country),
      shippingAddress: d.shippingSame ? empty : text(d.shippingAddress),
      creditPeriodDays: Number(d.terms),
      paymentTerms: TERMS.find((t) => t.value === d.terms)?.label ?? `Net ${d.terms}`,
      preferredPaymentMethod: (d.preferredPaymentMethod as ArPaymentMethod) || empty,
      creditLimit: Number.isFinite(limit) ? limit : 0,
      tin: d.tin || empty,
      notes: text(d.notes),
      parentId: d.isSub ? d.parentId : empty,
      tags: d.tags.split(",").map((t) => t.trim()).filter(Boolean),
      taxExempt: d.taxExempt,
      taxExemptReason: d.taxExempt ? d.taxExemptReason.trim() : empty,
    };
    if (editing) {
      body.creditStatus = d.creditStatus;
      body.status = d.status;
    } else {
      const ob = parseAmount(d.openingBalance);
      if (Number.isFinite(ob) && ob > 0) {
        body.openingBalance = ob;
        body.openingBalanceDate = d.openingBalanceDate;
      }
    }
    void run(async () => {
      const saved = editing
        ? await api<Customer>(`/api/v1/ar/customers/${customer!.id}`, { method: "PATCH", body: JSON.stringify(body) })
        : await api<Customer>("/api/v1/ar/customers", { method: "POST", body: JSON.stringify(body) });
      onSaved(saved);
      return editing ? `${saved.name} updated` : `${saved.name} added as ${saved.code}`;
    });
  }

  const toggle = (id: SectionId) => () => setOpen((o) => ({ ...o, [id]: !o[id] }));
  const termsLabel = TERMS.find((t) => t.value === d.terms)?.label ?? `Net ${d.terms}`;

  return (
    <Drawer
      title={editing ? `Edit ${customer!.name}` : "New customer"}
      subtitle={editing ? `${customer!.code} · changes are recorded in the activity log` : "Only the display name is required. Add the rest now or later."}
      wide
      onClose={onClose}
      footer={<Footer onCancel={onClose} busy={busy} label={editing ? "Save changes" : "Save customer"} formId="customer-form" />}
    >
      <form id="customer-form" className="cf" onSubmit={submit} noValidate>
        <FormError message={error} />

        {dupes.length > 0 && (
          <div className={`cf-dupes ${blocking ? "blocking" : ""}`} role="status">
            <AlertTriangle size={16} aria-hidden="true" />
            <div>
              <strong>{blocking ? "This customer already exists" : "Possible duplicate"}</strong>
              <ul>
                {dupes.map((x) => (
                  <li key={x.id}>
                    <a href={`/customers/${x.id}`} target="_blank" rel="noreferrer">
                      {x.name}
                    </a>{" "}
                    <span className="muted">
                      {x.code} · same {x.matched.join(" and ")}
                      {x.status === "INACTIVE" ? " · inactive" : ""}
                    </span>
                  </li>
                ))}
              </ul>
              {blocking && <p className="small muted">Use a different display name or TIN, or open the existing customer.</p>}
            </div>
          </div>
        )}

        <div className="cf-basic">
          <div className="form-grid">
            <Field label="Customer display name" required error={show("name")} className="span-2" hint="Shown on invoices and statements">
              <input className="input" value={d.name} onChange={(e) => set("name", e.target.value)} onBlur={blur("name")} autoComplete="off" maxLength={200} />
            </Field>
            <Field label="Company name" hint="Legal name, if different">
              <input className="input" value={d.companyName} onChange={(e) => set("companyName", e.target.value)} maxLength={200} />
            </Field>
            <Field label="Customer type">
              <Select
                value={d.customerType}
                onChange={(v) => set("customerType", v as CustomerType)}
                searchable={false}
                options={CUSTOMER_TYPES.map((t) => ({ value: t, label: humanize(t) }))}
              />
            </Field>
            <div className="span-2">
              <label className="check">
                <input type="checkbox" checked={d.isSub} onChange={(e) => set("isSub", e.target.checked)} />
                <span>Is a sub-customer (a branch, site or job of another customer)</span>
              </label>
            </div>
            {d.isSub && (
              <Field label="Parent customer" required error={show("parentId")} className="span-2" hint="Its balance also counts toward the parent's total">
                <Select
                  value={d.parentId}
                  onChange={(v) => set("parentId", v)}
                  placeholder={allCustomers.loading ? "Loading customers…" : "Choose a customer…"}
                  searchable
                  options={parentOptions}
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
            <Field label="Contact person">
              <input className="input" value={d.contactPerson} onChange={(e) => set("contactPerson", e.target.value)} />
            </Field>
            <Field label="Website" error={show("website")} className="span-2">
              <input className="input" value={d.website} onChange={(e) => set("website", e.target.value)} onBlur={blur("website")} placeholder="example.com" />
            </Field>
          </div>
        </Section>

        <Section title="Billing address" icon={MapPin} open={open.address} onToggle={toggle("address")} summary={d.physicalAddress.split("\n")[0]}>
          <div className="form-grid">
            <Field label="Billing address" className="span-2">
              <textarea className="input" rows={2} value={d.physicalAddress} onChange={(e) => set("physicalAddress", e.target.value)} placeholder="Street, district, city" />
            </Field>
            <Field label="Country">
              <input className="input" value={d.country} onChange={(e) => set("country", e.target.value)} placeholder="Rwanda" />
            </Field>
            <div className="span-2">
              <label className="check">
                <input type="checkbox" checked={d.shippingSame} onChange={(e) => set("shippingSame", e.target.checked)} />
                <span>Ship to the billing address</span>
              </label>
            </div>
            {!d.shippingSame && (
              <Field label="Shipping address" className="span-2">
                <textarea className="input" rows={2} value={d.shippingAddress} onChange={(e) => set("shippingAddress", e.target.value)} />
              </Field>
            )}
          </div>
        </Section>

        <Section
          title="Payment and credit"
          icon={CreditCard}
          open={open.payment}
          onToggle={toggle("payment")}
          summary={[termsLabel, d.creditLimit && `limit ${d.creditLimit}`].filter(Boolean).join(" · ")}
        >
          <div className="form-grid">
            <Field label="Terms" error={show("terms")} hint="Sets the due date on new invoices">
              <Select
                value={TERMS.some((t) => t.value === d.terms) ? d.terms : "custom"}
                onChange={(v) => set("terms", v === "custom" ? d.terms : v)}
                searchable={false}
                options={[...TERMS, ...(TERMS.some((t) => t.value === d.terms) ? [] : [{ value: "custom", label: `Net ${d.terms}` }])]}
              />
            </Field>
            <Field label="Preferred payment method">
              <Select
                value={d.preferredPaymentMethod}
                onChange={(v) => set("preferredPaymentMethod", v)}
                searchable={false}
                options={[{ value: "", label: "None" }, ...PAYMENT_METHODS]}
              />
            </Field>
            <Field label={`Credit limit (${currency})`} error={show("creditLimit")} hint="Leave empty for no limit">
              <MoneyInput value={d.creditLimit} onChange={(v) => set("creditLimit", v)} invalid={Boolean(show("creditLimit"))} />
            </Field>
            {editing && (
              <>
                <Field label="Credit status" hint="On hold or blocked stops new invoices; payments are still accepted">
                  <Select
                    value={d.creditStatus}
                    onChange={(v) => set("creditStatus", v as Draft["creditStatus"])}
                    searchable={false}
                    options={[
                      { value: "GOOD", label: "Good" },
                      { value: "WATCH", label: "Watch" },
                      { value: "ON_HOLD", label: "On hold" },
                      { value: "BLOCKED", label: "Blocked" },
                    ]}
                  />
                </Field>
                <Field label="Status" hint={toNumber(customer!.balance) !== 0 ? "Settle the balance before making the customer inactive" : undefined}>
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
              </>
            )}
          </div>
        </Section>

        <Section
          title={editing ? "Tax" : "Tax and opening balance"}
          icon={Receipt}
          open={open.tax}
          onToggle={toggle("tax")}
          summary={[d.tin && `TIN ${d.tin}`, d.openingBalance && `opening ${d.openingBalance}`].filter(Boolean).join(" · ")}
        >
          <div className="form-grid">
            <Field label="TIN" error={show("tin")} hint={editing ? "Locked once the customer has posted invoices" : "9-digit RRA taxpayer number"}>
              <input
                className={`input ${show("tin") ? "invalid" : ""}`}
                value={d.tin}
                onChange={(e) => set("tin", e.target.value.replace(/\D/g, "").slice(0, 9))}
                onBlur={blur("tin")}
                inputMode="numeric"
              />
            </Field>
            <div />
            <div className="span-2">
              <label className="check">
                <input type="checkbox" checked={d.taxExempt} onChange={(e) => set("taxExempt", e.target.checked)} />
                <span>Tax exempt: invoices to this customer carry no tax</span>
              </label>
            </div>
            {d.taxExempt && (
              <Field label="Exemption reason" required error={show("taxExemptReason")} className="span-2" hint="Kept on file for the tax authority, e.g. diplomatic mission or exemption certificate number">
                <input className="input" value={d.taxExemptReason} onChange={(e) => set("taxExemptReason", e.target.value)} onBlur={blur("taxExemptReason")} maxLength={300} />
              </Field>
            )}
            {editing ? (
              <p className="small muted span-2">
                Opening balance: {currency} {amount(customer!.openingBalance ?? 0)}. To change it, post a journal or a credit note so the books keep the history.
              </p>
            ) : (
              <>
                <Field label={`Opening balance (${currency})`} error={show("openingBalance")} hint="What the customer already owed before you started using Excel Edge">
                  <MoneyInput value={d.openingBalance} onChange={(v) => set("openingBalance", v)} invalid={Boolean(show("openingBalance"))} />
                </Field>
                <Field label="As of" error={show("openingBalanceDate")}>
                  <input className="input" type="date" max={isoDay()} value={d.openingBalanceDate} onChange={(e) => set("openingBalanceDate", e.target.value)} />
                </Field>
              </>
            )}
          </div>
        </Section>

        <Section title="Notes and tags" icon={FileText} open={open.notes} onToggle={toggle("notes")} summary={[d.tags, d.notes.split("\n")[0]].filter(Boolean).join(" · ")}>
          <Field label="Tags" error={show("tags")} hint="Comma-separated, e.g. Wholesale, Kigali. Filter the customer list by them.">
            <input className="input" value={d.tags} onChange={(e) => set("tags", e.target.value)} onBlur={blur("tags")} placeholder="Wholesale, Kigali" />
          </Field>
          <Field label="Internal notes" hint="Not shown to the customer. Dated notes go on the profile's Notes tab.">
            <textarea className="input" rows={3} value={d.notes} onChange={(e) => set("notes", e.target.value)} maxLength={4000} />
          </Field>
        </Section>
      </form>
    </Drawer>
  );
}
