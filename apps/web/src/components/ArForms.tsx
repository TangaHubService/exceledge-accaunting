import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { addDays, Footer, FormError, MoneyInput, parseAmount, SummaryRows, useSubmit } from "./forms";
import { useCompany } from "../lib/company";
import { amount, date, humanize, isoDay, money, toNumber } from "../lib/format";
import { useResource, useSession } from "../lib/session";
import type { Customer, CustomerLedger, CustomerStatement, CustomerType } from "../lib/types";
import { SettlementAccountField } from "./BankingForms";
import { Select } from "./Select";
import { Drawer, Field } from "./ui";

export const CUSTOMER_TYPES: CustomerType[] = [
  "CREDIT",
  "CORPORATE",
  "GOVERNMENT",
  "NGO",
  "INDIVIDUAL",
  "EXPORT",
  "FOREIGN",
  "CASH",
  "WALK_IN",
];

export const PAYMENT_METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "MOBILE_MONEY", label: "Mobile money" },
  { value: "BANK", label: "Bank transfer" },
  { value: "CARD", label: "Card" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "ONLINE", label: "Online" },
];

/* ── Customer ──────────────────────────────────────────── */

export function CustomerForm({ customer, onClose, onSaved }: { customer?: Customer; onClose: () => void; onSaved: (c: Customer) => void }) {
  const { api } = useSession();
  const editing = Boolean(customer);
  const [form, setForm] = useState({
    name: customer?.name ?? "",
    customerType: customer?.customerType ?? ("CREDIT" as CustomerType),
    tin: customer?.tin ?? "",
    telephone: customer?.telephone ?? "",
    email: customer?.email ?? "",
    physicalAddress: customer?.physicalAddress ?? "",
    creditLimit: customer ? amount(customer.creditLimit) : "",
    creditPeriodDays: String(customer?.creditPeriodDays ?? 30),
    creditStatus: customer?.creditStatus ?? "GOOD",
    status: customer?.status ?? "ACTIVE",
    notes: customer?.notes ?? "",
  });
  const { busy, error, run } = useSubmit();
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const tinInvalid = form.tin !== "" && !/^\d{9}$/.test(form.tin);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (tinInvalid) return;
    const limit = parseAmount(form.creditLimit);
    const common = {
      name: form.name.trim(),
      customerType: form.customerType,
      telephone: form.telephone || undefined,
      email: form.email || undefined,
      creditLimit: Number.isFinite(limit) ? limit : undefined,
      creditPeriodDays: Number(form.creditPeriodDays) || 0,
      notes: form.notes || undefined,
    };
    void run(async () => {
      const result = editing
        ? await api<Customer>(`/api/v1/ar/customers/${customer!.id}`, {
            method: "PATCH",
            body: JSON.stringify({ ...common, creditStatus: form.creditStatus, status: form.status }),
          })
        : await api<Customer>("/api/v1/ar/customers", {
            method: "POST",
            body: JSON.stringify({ ...common, tin: form.tin || undefined, physicalAddress: form.physicalAddress || undefined }),
          });
      onSaved(result);
      return editing ? "Customer updated" : `${result.name} added as ${result.code}`;
    });
  }

  return (
    <Drawer
      title={editing ? `Edit ${customer!.name}` : "New customer"}
      onClose={onClose}
      footer={<Footer onCancel={onClose} busy={busy} label={editing ? "Save changes" : "Add customer"} formId="customer-form" />}
    >
      <form id="customer-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="form-grid">
          <Field label="Customer name" required className="span-2">
            <input className="input" value={form.name} onChange={(e) => set("name")(e.target.value)} required />
          </Field>
          <Field label="Customer type">
            <Select
              value={form.customerType}
              onChange={set("customerType")}
              searchable={false}
              options={CUSTOMER_TYPES.map((t) => ({ value: t, label: humanize(t) }))}
            />
          </Field>
          <Field label="TIN" hint={editing ? "TIN can't be changed after the customer is created." : "9-digit RRA taxpayer number"} error={tinInvalid ? "TIN must be 9 digits" : null}>
            <input
              className={`input ${tinInvalid ? "invalid" : ""}`}
              value={form.tin}
              onChange={(e) => set("tin")(e.target.value.replace(/\D/g, "").slice(0, 9))}
              inputMode="numeric"
              disabled={editing}
            />
          </Field>
        </div>

        <div className="form-section-title" style={{ marginTop: 22 }}>Credit terms</div>
        <div className="form-grid">
          <Field label="Credit limit" hint="Leave empty for no limit set">
            <MoneyInput value={form.creditLimit} onChange={set("creditLimit")} />
          </Field>
          <Field label="Payment due after" hint="Days after the invoice date">
            <input className="input num" type="number" min={0} value={form.creditPeriodDays} onChange={(e) => set("creditPeriodDays")(e.target.value)} />
          </Field>
          {editing && (
            <>
              <Field label="Credit status" hint="Customers on hold or blocked can't be invoiced">
                <Select
                  value={form.creditStatus}
                  onChange={set("creditStatus")}
                  options={[
                    { value: "GOOD", label: "Good" },
                    { value: "WATCH", label: "Watch" },
                    { value: "ON_HOLD", label: "On hold" },
                    { value: "BLOCKED", label: "Blocked" },
                  ]}
                />
              </Field>
              <Field label="Status">
                <Select
                  value={form.status}
                  onChange={set("status")}
                  options={[
                    { value: "ACTIVE", label: "Active" },
                    { value: "INACTIVE", label: "Inactive" },
                  ]}
                />
              </Field>
            </>
          )}
        </div>

        <div className="form-section-title" style={{ marginTop: 22 }}>Contact</div>
        <div className="form-grid">
          <Field label="Phone">
            <input className="input" type="tel" value={form.telephone} onChange={(e) => set("telephone")(e.target.value)} placeholder="+250 7…" />
          </Field>
          <Field label="Email">
            <input className="input" type="email" value={form.email} onChange={(e) => set("email")(e.target.value)} />
          </Field>
          {!editing && (
            <Field label="Address" className="span-2">
              <input className="input" value={form.physicalAddress} onChange={(e) => set("physicalAddress")(e.target.value)} />
            </Field>
          )}
          <Field label="Notes" className="span-2">
            <textarea className="input" value={form.notes} onChange={(e) => set("notes")(e.target.value)} />
          </Field>
        </div>
      </form>
    </Drawer>
  );
}

/* ── Shared customer data ──────────────────────────────── */

function useActiveCustomers(skip: boolean) {
  const list = useResource<Customer[]>(skip ? null : "/api/v1/ar/customers");
  return useMemo(() => (list.data ?? []).filter((c) => c.status === "ACTIVE"), [list.data]);
}

export type OpenInvoice = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  gross: number;
  outstanding: number;
};

/** Outstanding invoices with their ids (the statement has numbers, the ledger links numbers to ids). */
export function useOpenInvoices(customerId: string | null) {
  const statement = useResource<CustomerStatement>(customerId ? `/api/v1/ar/customers/${customerId}/statement` : null);
  const ledger = useResource<CustomerLedger>(customerId ? `/api/v1/ar/customers/${customerId}/ledger` : null);
  const invoices = useMemo<OpenInvoice[] | undefined>(() => {
    if (!statement.data || !ledger.data) return undefined;
    const ids = new Map(ledger.data.entries.filter((e) => e.docType === "INVOICE" && e.docNumber).map((e) => [e.docNumber!, e.docId]));
    return statement.data.rows
      .filter((r) => ids.has(r.invoiceNumber))
      .map((r) => ({ id: ids.get(r.invoiceNumber)!, ...r }))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [statement.data, ledger.data]);
  return { invoices, error: statement.error ?? ledger.error };
}

function CustomerPicker({
  customer,
  customerId,
  onChange,
}: {
  customer?: Customer;
  customerId: string;
  onChange: (id: string, c?: Customer) => void;
}) {
  const customers = useActiveCustomers(Boolean(customer));
  if (customer) {
    return (
      <div className="field">
        <span className="field-label">Customer</span>
        <div style={{ padding: "6px 0" }}>
          <strong>{customer.name}</strong> <span className="muted">· {customer.code}</span>
        </div>
      </div>
    );
  }
  return (
    <Field label="Customer" required className="span-2">
      <Select
        value={customerId}
        onChange={(v) => onChange(v, customers.find((c) => c.id === v))}
        placeholder="Select a customer…"
        required
        searchable
        options={customers.map((c) => ({ value: c.id, label: c.name, hint: c.code }))}
      />
    </Field>
  );
}

/* ── Invoice ───────────────────────────────────────────── */

export function InvoiceForm({ customer: preset, onClose, onSaved }: { customer?: Customer; onClose: () => void; onSaved: () => void }) {
  const { api, can } = useSession();
  const { currency } = useCompany();
  const [picked, setPicked] = useState<Customer | undefined>(preset);
  const [customerId, setCustomerId] = useState(preset?.id ?? "");
  const [invoiceDate, setInvoiceDate] = useState(isoDay());
  const [dueDate, setDueDate] = useState("");
  const [dueTouched, setDueTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [net, setNet] = useState("");
  const [tax, setTax] = useState("");
  const [discount, setDiscount] = useState("");
  const [override, setOverride] = useState(false);
  const { busy, error, run } = useSubmit(onSaved);

  const customer = preset ?? picked;
  const terms = customer?.creditPeriodDays ?? 0;
  const autoDue = addDays(invoiceDate, terms);
  const effectiveDue = dueTouched && dueDate ? dueDate : autoDue;

  const n = parseAmount(net);
  const t = parseAmount(tax) || 0;
  const d = parseAmount(discount) || 0;
  const total = (Number.isFinite(n) ? n : 0) + t - d;

  const limit = toNumber(customer?.creditLimit);
  const balance = toNumber(customer?.balance);
  const exceedsLimit = customer && limit > 0 && balance + total > limit;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(n) || n <= 0) return;
    void run(async () => {
      const inv = await api<{ invoiceNumber: string }>("/api/v1/ar/invoices", {
        method: "POST",
        body: JSON.stringify({
          customerId: customer!.id,
          invoiceDate,
          dueDate: effectiveDue,
          net: n,
          tax: t || undefined,
          discount: d || undefined,
          description: description || undefined,
          creditOverride: override || undefined,
        }),
      });
      return `Invoice ${inv.invoiceNumber} posted`;
    });
  }

  return (
    <Drawer
      title="New invoice"
      subtitle="Posts to the customer's account and the general ledger immediately."
      onClose={onClose}
      footer={<Footer onCancel={onClose} busy={busy} label="Post invoice" formId="invoice-form" />}
    >
      <form id="invoice-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="form-grid">
          <CustomerPicker
            customer={preset}
            customerId={customerId}
            onChange={(id, c) => {
              setCustomerId(id);
              setPicked(c);
            }}
          />
          <Field label="Invoice date" required>
            <input className="input" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} required />
          </Field>
          <Field label="Due date" hint={customer && !dueTouched ? `${terms}-day terms` : undefined}>
            <input
              className="input"
              type="date"
              value={effectiveDue}
              min={invoiceDate}
              onChange={(e) => {
                setDueTouched(true);
                setDueDate(e.target.value);
              }}
            />
          </Field>
          <Field label="Description" className="span-2" hint="Appears on the customer statement">
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Supply of goods, September" />
          </Field>
        </div>

        <div className="form-section-title" style={{ marginTop: 22 }}>Amounts ({currency})</div>
        <div className="form-grid">
          <Field label="Amount before VAT" required className="span-2">
            <MoneyInput value={net} onChange={setNet} required />
          </Field>
          <Field label="VAT">
            <MoneyInput value={tax} onChange={setTax} placeholder="0" />
          </Field>
          <Field label="Discount">
            <MoneyInput value={discount} onChange={setDiscount} placeholder="0" />
          </Field>
        </div>

        <SummaryRows
          rows={[
            ["Amount before VAT", amount(Number.isFinite(n) ? n : 0)],
            ["VAT", amount(t)],
            ...(d ? ([["Discount", `−${amount(d)}`]] as Array<[ReactNode, ReactNode]>) : []),
            [`Invoice total`, money(total, currency), true],
          ]}
        />

        {customer && limit > 0 && (
          <p className={`small ${exceedsLimit ? "text-negative" : "muted"}`} style={{ marginTop: 10 }}>
            {customer.name} owes {money(balance, currency)} against a {money(limit, currency)} limit.
            {exceedsLimit && " This invoice takes them over their credit limit."}
          </p>
        )}
        {exceedsLimit && can("ar:credit-override") && (
          <label className="check" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} />
            Approve invoicing above the credit limit
          </label>
        )}
      </form>
    </Drawer>
  );
}

/* ── Receipt ───────────────────────────────────────────── */

export function ReceiptForm({
  customer: preset,
  invoiceNumber,
  onClose,
  onSaved,
}: {
  customer?: Customer;
  /** Pre-select this invoice for allocation. */
  invoiceNumber?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useSession();
  const { currency } = useCompany();
  const [customerId, setCustomerId] = useState(preset?.id ?? "");
  const [receiptDate, setReceiptDate] = useState(isoDay());
  const [method, setMethod] = useState("CASH");
  const [total, setTotal] = useState("");
  const [reference, setReference] = useState("");
  const [financialAccountId, setFinancialAccountId] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const { busy, error, setError, run } = useSubmit(onSaved);
  const { invoices, error: invoicesError } = useOpenInvoices(customerId || null);

  const received = parseAmount(total);

  // Apply the payment to the chosen invoice, or oldest first, whenever the amount or invoices change.
  useEffect(() => {
    if (!invoices) return;
    let remaining = Number.isFinite(received) ? received : 0;
    const ordered = invoiceNumber
      ? [...invoices.filter((i) => i.invoiceNumber === invoiceNumber), ...invoices.filter((i) => i.invoiceNumber !== invoiceNumber)]
      : invoices;
    const next: Record<string, string> = {};
    for (const inv of ordered) {
      const apply = Math.min(remaining, inv.outstanding);
      if (apply > 0) next[inv.id] = amount(apply, apply % 1 ? 2 : 0);
      remaining -= apply;
    }
    setAllocations(next);
  }, [invoices, received, invoiceNumber]);

  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !invoiceNumber || !invoices) return;
    prefilled.current = true;
    const inv = invoices.find((i) => i.invoiceNumber === invoiceNumber);
    if (inv) setTotal(amount(inv.outstanding));
  }, [invoiceNumber, invoices]);

  const applied = Object.values(allocations).reduce((s, v) => s + (parseAmount(v) || 0), 0);
  const unapplied = (Number.isFinite(received) ? received : 0) - applied;
  const overApplied = invoices?.some((i) => (parseAmount(allocations[i.id] ?? "") || 0) > i.outstanding + 0.001);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(received) || received <= 0) return;
    if (unapplied < -0.001) {
      setError("You've applied more to invoices than the amount received.");
      return;
    }
    if (overApplied) {
      setError("An invoice can't receive more than its outstanding balance.");
      return;
    }
    const rows = Object.entries(allocations)
      .map(([invoiceId, v]) => ({ invoiceId, amount: parseAmount(v) || 0 }))
      .filter((r) => r.amount > 0);
    void run(async () => {
      const r = await api<{ receiptNumber: string }>("/api/v1/ar/receipts", {
        method: "POST",
        body: JSON.stringify({
          customerId,
          receiptDate,
          method,
          amount: received,
          reference: reference || undefined,
          financialAccountId: financialAccountId || undefined,
          allocations: rows.length ? rows : undefined,
        }),
      });
      return `Receipt ${r.receiptNumber} recorded`;
    });
  }

  return (
    <Drawer
      title="Record payment received"
      onClose={onClose}
      wide
      footer={<Footer onCancel={onClose} busy={busy} label="Record payment" formId="receipt-form" />}
    >
      <form id="receipt-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="form-grid">
          <CustomerPicker customer={preset} customerId={customerId} onChange={(id) => setCustomerId(id)} />
          <Field label={`Amount received (${currency})`} required>
            <MoneyInput value={total} onChange={setTotal} required />
          </Field>
          <Field label="Date received" required>
            <input className="input" type="date" value={receiptDate} onChange={(e) => setReceiptDate(e.target.value)} required />
          </Field>
          <Field label="Payment method">
            <Select value={method} onChange={setMethod} options={PAYMENT_METHODS} />
          </Field>
          <Field label="Reference" hint="Transaction ID, cheque or slip number">
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <SettlementAccountField label="Paid into" value={financialAccountId} onChange={setFinancialAccountId} />
        </div>

        {customerId && (
          <>
            <div className="form-section-title" style={{ marginTop: 24 }}>Apply to invoices</div>
            {invoicesError && <p className="field-error">{invoicesError}</p>}
            {!invoices && !invoicesError && <p className="muted small">Loading open invoices…</p>}
            {invoices && invoices.length === 0 && (
              <p className="muted small">This customer has no open invoices. The payment will be kept as credit on their account.</p>
            )}
            {invoices && invoices.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Invoice</th>
                      <th className="hide-sm">Due</th>
                      <th className="num">Outstanding</th>
                      <th className="num" style={{ width: 150 }}>
                        Apply
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.map((inv) => {
                      const v = allocations[inv.id] ?? "";
                      const tooMuch = (parseAmount(v) || 0) > inv.outstanding + 0.001;
                      return (
                        <tr key={inv.id}>
                          <td className="nowrap">{inv.invoiceNumber}</td>
                          <td className="hide-sm">{date(inv.dueDate)}</td>
                          <td className="num">{amount(inv.outstanding)}</td>
                          <td style={{ padding: "5px 8px" }}>
                            <MoneyInput
                              value={v}
                              invalid={tooMuch}
                              aria-label={`Amount applied to ${inv.invoiceNumber}`}
                              onChange={(val) => setAllocations((a) => ({ ...a, [inv.id]: val }))}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {Number.isFinite(received) && received > 0 && (
              <SummaryRows
                rows={[
                  ["Applied to invoices", amount(applied)],
                  [
                    unapplied >= 0 ? "Kept as credit on account" : "Over-applied",
                    <span className={unapplied < -0.001 ? "text-negative" : undefined}>{amount(unapplied)}</span>,
                    true,
                  ],
                ]}
              />
            )}
          </>
        )}
      </form>
    </Drawer>
  );
}

/* ── Credit note ───────────────────────────────────────── */

export function CreditNoteForm({ customer, onClose, onSaved }: { customer: Customer; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const { currency } = useCompany();
  const { invoices } = useOpenInvoices(customer.id);
  const [invoiceId, setInvoiceId] = useState("");
  const [noteDate, setNoteDate] = useState(isoDay());
  const [reason, setReason] = useState("");
  const [net, setNet] = useState("");
  const [tax, setTax] = useState("");
  const { busy, error, run } = useSubmit(onSaved);

  const n = parseAmount(net);
  const t = parseAmount(tax) || 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(n) || n <= 0) return;
    void run(async () => {
      const note = await api<{ creditNoteNumber: string }>("/api/v1/ar/credit-notes", {
        method: "POST",
        body: JSON.stringify({ customerId: customer.id, invoiceId: invoiceId || undefined, noteDate, reason, net: n, tax: t || undefined }),
      });
      return `Credit note ${note.creditNoteNumber} posted`;
    });
  }

  return (
    <Drawer
      title="Issue credit note"
      subtitle={`Reduces what ${customer.name} owes.`}
      onClose={onClose}
      footer={<Footer onCancel={onClose} busy={busy} label="Post credit note" formId="credit-form" />}
    >
      <form id="credit-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="form-grid">
          <Field label="Against invoice" className="span-2" hint="Optional — link the credit to a specific invoice">
            <Select
              value={invoiceId}
              onChange={setInvoiceId}
              options={[
                { value: "", label: "Not linked to an invoice" },
                ...(invoices ?? []).map((inv) => ({ value: inv.id, label: inv.invoiceNumber, hint: `${amount(inv.outstanding)} outstanding` })),
              ]}
            />
          </Field>
          <Field label="Reason" required className="span-2">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Goods returned" required />
          </Field>
          <Field label="Date" required>
            <input className="input" type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} required />
          </Field>
          <div />
          <Field label={`Amount before VAT (${currency})`} required>
            <MoneyInput value={net} onChange={setNet} required />
          </Field>
          <Field label="VAT">
            <MoneyInput value={tax} onChange={setTax} placeholder="0" />
          </Field>
        </div>
        <SummaryRows rows={[["Credit total", money((Number.isFinite(n) ? n : 0) + t, currency), true]]} />
      </form>
    </Drawer>
  );
}

/* ── Deposit ───────────────────────────────────────────── */

export function DepositForm({ customer, onClose, onSaved }: { customer: Customer; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const { currency } = useCompany();
  const [depositDate, setDepositDate] = useState(isoDay());
  const [method, setMethod] = useState("CASH");
  const [value, setValue] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const { busy, error, run } = useSubmit(onSaved);

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = parseAmount(value);
    if (!Number.isFinite(n) || n <= 0) return;
    void run(async () => {
      const dep = await api<{ depositNumber: string }>("/api/v1/ar/deposits", {
        method: "POST",
        body: JSON.stringify({
          customerId: customer.id,
          depositDate,
          method,
          amount: n,
          reference: reference || undefined,
          description: description || undefined,
        }),
      });
      return `Deposit ${dep.depositNumber} recorded`;
    });
  }

  return (
    <Drawer
      title="Record customer deposit"
      subtitle="Money received in advance, held until it's applied to an invoice."
      onClose={onClose}
      footer={<Footer onCancel={onClose} busy={busy} label="Record deposit" formId="deposit-form" />}
    >
      <form id="deposit-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="form-grid">
          <Field label={`Amount (${currency})`} required>
            <MoneyInput value={value} onChange={setValue} required />
          </Field>
          <Field label="Date received" required>
            <input className="input" type="date" value={depositDate} onChange={(e) => setDepositDate(e.target.value)} required />
          </Field>
          <Field label="Payment method">
            <Select value={method} onChange={setMethod} options={PAYMENT_METHODS} />
          </Field>
          <Field label="Reference">
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Description" className="span-2">
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>
      </form>
    </Drawer>
  );
}
