import { SUPPLIER_CATEGORIES } from "@exceledge/accounting-domain";
import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { accountOptions } from "../pages/Accounts";
import { useCompany } from "../lib/company";
import { amount, date, humanize, isoDay, money, toNumber } from "../lib/format";
import { useResource, useSession } from "../lib/session";
import type { AccountType, ApAdvance, ApBill, ApPayment, ApPaymentMethod, Supplier } from "../lib/types";
import { SettlementAccountField } from "./BankingForms";
import { addDays, Footer, FormError, MoneyInput, parseAmount, SummaryRows, useSubmit } from "./forms";
import { Select, type SelectOption } from "./Select";
import { Drawer, Field } from "./ui";

export const AP_METHODS: Array<{ value: ApPaymentMethod; label: string }> = [
  { value: "BANK", label: "Bank transfer" },
  { value: "EFT", label: "EFT" },
  { value: "MOBILE_MONEY", label: "Mobile money" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "CASH", label: "Cash" },
];

export const methodLabel = (m: string) => AP_METHODS.find((x) => x.value === m)?.label ?? humanize(m);

const EXPENSE_TYPES: AccountType[] = ["COST_OF_SALES", "EXPENSE", "OTHER_EXPENSE", "ASSET"];
const LIABILITY_TYPES: AccountType[] = ["LIABILITY"];

function useAccountOptions(types: AccountType[], emptyLabel: string): SelectOption[] {
  const { accounts } = useCompany();
  return useMemo(
    () => [{ value: "", label: emptyLabel }, ...accountOptions(accounts.filter((a) => a.isActive && types.includes(a.type)))],
    [accounts, emptyLabel, types],
  );
}

/* ── Supplier ──────────────────────────────────────────── */

export function SupplierForm({ supplier, onClose, onSaved }: { supplier?: Supplier; onClose: () => void; onSaved: (s: Supplier) => void }) {
  const { api } = useSession();
  const { currency } = useCompany();
  const editing = Boolean(supplier);
  const [form, setForm] = useState({
    name: supplier?.name ?? "",
    category: supplier?.category ?? "",
    tin: supplier?.tin ?? "",
    vatNumber: supplier?.vatNumber ?? "",
    contactPerson: supplier?.contactPerson ?? "",
    telephone: supplier?.telephone ?? "",
    email: supplier?.email ?? "",
    physicalAddress: supplier?.physicalAddress ?? "",
    creditPeriodDays: String(supplier?.creditPeriodDays ?? 30),
    paymentTerms: supplier?.paymentTerms ?? "",
    apAccountId: supplier?.apAccountId ?? "",
    defaultExpenseAccountId: supplier?.defaultExpenseAccountId ?? "",
    whtCategory: supplier?.whtCategory ?? "",
    whtRate: supplier && toNumber(supplier.whtRate) ? String(toNumber(supplier.whtRate)) : "",
    bankName: supplier?.bankName ?? "",
    bankAccountNumber: supplier?.bankAccountNumber ?? "",
    openingBalance: "",
    status: supplier?.status ?? "ACTIVE",
    notes: supplier?.notes ?? "",
  });
  const { busy, error, run } = useSubmit();
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const apOptions = useAccountOptions(LIABILITY_TYPES, "Company default payables account");
  const expenseOptions = useAccountOptions(EXPENSE_TYPES, "Company default purchases account");

  const tinInvalid = form.tin !== "" && !/^\d{9}$/.test(form.tin);
  const rate = form.whtRate === "" ? 0 : Number(form.whtRate);
  const rateInvalid = !Number.isFinite(rate) || rate < 0 || rate >= 100;
  const emailInvalid = form.email !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (tinInvalid || rateInvalid || emailInvalid) return;
    const text = (v: string) => v.trim() || undefined;
    const common = {
      name: form.name.trim(),
      category: text(form.category),
      vatNumber: text(form.vatNumber),
      contactPerson: text(form.contactPerson),
      telephone: text(form.telephone),
      email: text(form.email),
      physicalAddress: text(form.physicalAddress),
      creditPeriodDays: Number(form.creditPeriodDays) || 0,
      paymentTerms: text(form.paymentTerms),
      apAccountId: text(form.apAccountId),
      defaultExpenseAccountId: text(form.defaultExpenseAccountId),
      whtCategory: text(form.whtCategory),
      whtRate: rate,
      bankName: text(form.bankName),
      bankAccountNumber: text(form.bankAccountNumber),
      notes: text(form.notes),
    };
    const opening = parseAmount(form.openingBalance);
    void run(async () => {
      const result = editing
        ? await api<Supplier>(`/api/v1/ap/suppliers/${supplier!.id}`, { method: "PATCH", body: JSON.stringify({ ...common, status: form.status }) })
        : await api<Supplier>("/api/v1/ap/suppliers", {
            method: "POST",
            body: JSON.stringify({ ...common, tin: text(form.tin), openingBalance: Number.isFinite(opening) && opening > 0 ? opening : undefined }),
          });
      onSaved(result);
      return editing ? "Supplier updated" : `${result.name} added as ${result.code}`;
    });
  }

  return (
    <Drawer
      title={editing ? `Edit ${supplier!.name}` : "New supplier"}
      onClose={onClose}
      wide
      footer={<Footer onCancel={onClose} busy={busy} label={editing ? "Save changes" : "Add supplier"} formId="supplier-form" />}
    >
      <form id="supplier-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="form-grid">
          <Field label="Supplier name" required className="span-2">
            <input className="input" value={form.name} onChange={(e) => set("name")(e.target.value)} required />
          </Field>
          <Field label="Category">
            <Select
              value={form.category}
              onChange={set("category")}
              options={[{ value: "", label: "Not categorised" }, ...SUPPLIER_CATEGORIES.map((c) => ({ value: c, label: humanize(c) }))]}
            />
          </Field>
          <Field label="TIN" hint={editing ? "TIN can't be changed after the supplier is created." : "9-digit RRA taxpayer number"} error={tinInvalid ? "TIN must be 9 digits" : null}>
            <input
              className={`input ${tinInvalid ? "invalid" : ""}`}
              value={form.tin}
              onChange={(e) => set("tin")(e.target.value.replace(/\D/g, "").slice(0, 9))}
              inputMode="numeric"
              disabled={editing}
            />
          </Field>
          <Field label="VAT registration number">
            <input className="input" value={form.vatNumber} onChange={(e) => set("vatNumber")(e.target.value)} />
          </Field>
          {editing && (
            <Field label="Status" hint="Inactive suppliers can't receive new bills or payments">
              <Select
                value={form.status}
                onChange={set("status")}
                searchable={false}
                options={[
                  { value: "ACTIVE", label: "Active" },
                  { value: "INACTIVE", label: "Inactive" },
                ]}
              />
            </Field>
          )}
        </div>

        <div className="form-section-title" style={{ marginTop: 22 }}>Payment terms</div>
        <div className="form-grid">
          <Field label="Pay within" hint="Days after the bill date">
            <input className="input num" type="number" min={0} value={form.creditPeriodDays} onChange={(e) => set("creditPeriodDays")(e.target.value)} />
          </Field>
          <Field label="Terms note" hint="e.g. 50% on order, balance on delivery">
            <input className="input" value={form.paymentTerms} onChange={(e) => set("paymentTerms")(e.target.value)} />
          </Field>
          <Field label="Bank name">
            <input className="input" value={form.bankName} onChange={(e) => set("bankName")(e.target.value)} />
          </Field>
          <Field label="Bank account number">
            <input className="input" value={form.bankAccountNumber} onChange={(e) => set("bankAccountNumber")(e.target.value)} />
          </Field>
        </div>

        <div className="form-section-title" style={{ marginTop: 22 }}>Accounting and tax</div>
        <div className="form-grid">
          <Field label="Payables account">
            <Select value={form.apAccountId} onChange={set("apAccountId")} options={apOptions} />
          </Field>
          <Field label="Default expense account" hint="Used for this supplier's bills unless changed on the bill">
            <Select value={form.defaultExpenseAccountId} onChange={set("defaultExpenseAccountId")} options={expenseOptions} />
          </Field>
          <Field label="Withholding tax category">
            <input className="input" value={form.whtCategory} onChange={(e) => set("whtCategory")(e.target.value)} placeholder="As registered with RRA" />
          </Field>
          <Field label="Withholding tax rate (%)" hint="Leave empty if no tax is withheld" error={rateInvalid ? "Enter a rate from 0 to 99.99" : null}>
            <input className={`input num ${rateInvalid ? "invalid" : ""}`} inputMode="decimal" value={form.whtRate} onChange={(e) => set("whtRate")(e.target.value.replace(/[^\d.]/g, ""))} />
          </Field>
          {!editing && (
            <Field label={`Opening balance (${currency})`} hint="What you already owe this supplier today">
              <MoneyInput value={form.openingBalance} onChange={set("openingBalance")} placeholder="0" />
            </Field>
          )}
        </div>

        <div className="form-section-title" style={{ marginTop: 22 }}>Contact</div>
        <div className="form-grid">
          <Field label="Contact person">
            <input className="input" value={form.contactPerson} onChange={(e) => set("contactPerson")(e.target.value)} />
          </Field>
          <Field label="Phone">
            <input className="input" type="tel" value={form.telephone} onChange={(e) => set("telephone")(e.target.value)} placeholder="+250 7…" />
          </Field>
          <Field label="Email" error={emailInvalid ? "Enter a valid email address" : null}>
            <input className={`input ${emailInvalid ? "invalid" : ""}`} type="email" value={form.email} onChange={(e) => set("email")(e.target.value)} />
          </Field>
          <Field label="Address">
            <input className="input" value={form.physicalAddress} onChange={(e) => set("physicalAddress")(e.target.value)} />
          </Field>
          <Field label="Notes" className="span-2">
            <textarea className="input" value={form.notes} onChange={(e) => set("notes")(e.target.value)} />
          </Field>
        </div>
      </form>
    </Drawer>
  );
}

/* ── Shared supplier data ──────────────────────────────── */

export function useOpenBills(supplierId: string | null) {
  return useResource<ApBill[]>(supplierId ? `/api/v1/ap/bills?supplierId=${supplierId}` : null);
}

function SupplierPicker({
  supplier,
  supplierId,
  onChange,
}: {
  supplier?: Supplier;
  supplierId: string;
  onChange: (id: string, s?: Supplier) => void;
}) {
  const list = useResource<Supplier[]>(supplier ? null : "/api/v1/ap/suppliers");
  const active = useMemo(() => (list.data ?? []).filter((s) => s.status === "ACTIVE"), [list.data]);
  if (supplier) {
    return (
      <div className="field span-2">
        <span className="field-label">Supplier</span>
        <div style={{ padding: "6px 0" }}>
          <strong>{supplier.name}</strong> <span className="muted">· {supplier.code}</span>
        </div>
      </div>
    );
  }
  return (
    <Field label="Supplier" required className="span-2">
      <Select
        value={supplierId}
        onChange={(v) => onChange(v, active.find((s) => s.id === v))}
        placeholder="Select a supplier…"
        required
        searchable
        emptyText="No active suppliers yet"
        options={active.map((s) => ({ value: s.id, label: s.name, hint: s.code }))}
      />
    </Field>
  );
}

/* ── Bill ──────────────────────────────────────────────── */

export function BillForm({ supplier: preset, onClose, onSaved }: { supplier?: Supplier; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const { currency } = useCompany();
  const [picked, setPicked] = useState<Supplier | undefined>(preset);
  const [supplierId, setSupplierId] = useState(preset?.id ?? "");
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [billDate, setBillDate] = useState(isoDay());
  const [dueDate, setDueDate] = useState("");
  const [dueTouched, setDueTouched] = useState(false);
  const [poReference, setPoReference] = useState("");
  const [grnReference, setGrnReference] = useState("");
  const [description, setDescription] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [net, setNet] = useState("");
  const [tax, setTax] = useState("");
  const [discount, setDiscount] = useState("");
  const { busy, error, run } = useSubmit(onSaved);
  const expenseOptions = useAccountOptions(EXPENSE_TYPES, "Supplier's default account");

  const supplier = preset ?? picked;
  const terms = supplier?.creditPeriodDays ?? 0;
  const effectiveDue = dueTouched && dueDate ? dueDate : addDays(billDate, terms);
  const n = parseAmount(net);
  const t = parseAmount(tax) || 0;
  const d = parseAmount(discount) || 0;
  const total = (Number.isFinite(n) ? n : 0) + t - d;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(n) || n <= 0 || !supplier) return;
    void run(async () => {
      const bill = await api<{ billNumber: string }>("/api/v1/ap/bills", {
        method: "POST",
        body: JSON.stringify({
          supplierId: supplier.id,
          supplierInvoiceNumber: supplierInvoiceNumber.trim() || undefined,
          billDate,
          dueDate: effectiveDue,
          poReference: poReference.trim() || undefined,
          grnReference: grnReference.trim() || undefined,
          expenseAccountId: expenseAccountId || undefined,
          net: n,
          tax: t || undefined,
          discount: d || undefined,
          description: description.trim() || undefined,
        }),
      });
      return `Bill ${bill.billNumber} recorded`;
    });
  }

  return (
    <Drawer
      title="Record supplier bill"
      subtitle="Posts to the supplier's account and the general ledger immediately."
      onClose={onClose}
      wide
      footer={<Footer onCancel={onClose} busy={busy} label="Record bill" formId="bill-form" />}
    >
      <form id="bill-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="form-grid">
          <SupplierPicker
            supplier={preset}
            supplierId={supplierId}
            onChange={(id, s) => {
              setSupplierId(id);
              setPicked(s);
            }}
          />
          <Field label="Supplier's invoice number" hint="Must be unique for this supplier">
            <input className="input" value={supplierInvoiceNumber} onChange={(e) => setSupplierInvoiceNumber(e.target.value)} placeholder="As printed on their invoice" />
          </Field>
          <Field label="Bill date" required>
            <input className="input" type="date" value={billDate} onChange={(e) => setBillDate(e.target.value)} required />
          </Field>
          <Field label="Due date" hint={supplier && !dueTouched ? `${terms}-day terms` : undefined}>
            <input
              className="input"
              type="date"
              value={effectiveDue}
              min={billDate}
              onChange={(e) => {
                setDueTouched(true);
                setDueDate(e.target.value);
              }}
            />
          </Field>
          <Field label="Expense account">
            <Select value={expenseAccountId} onChange={setExpenseAccountId} options={expenseOptions} />
          </Field>
          <Field label="Purchase order">
            <input className="input" value={poReference} onChange={(e) => setPoReference(e.target.value)} placeholder="PO number" />
          </Field>
          <Field label="Goods received note">
            <input className="input" value={grnReference} onChange={(e) => setGrnReference(e.target.value)} placeholder="GRN number" />
          </Field>
          <Field label="Description" className="span-2">
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Stock purchase, September" />
          </Field>
        </div>

        <div className="form-section-title" style={{ marginTop: 22 }}>Amounts ({currency})</div>
        <div className="form-grid">
          <Field label="Amount before VAT" required className="span-2">
            <MoneyInput value={net} onChange={setNet} required />
          </Field>
          <Field label="Input VAT" hint="As shown on the supplier's EBM invoice">
            <MoneyInput value={tax} onChange={setTax} placeholder="0" />
          </Field>
          <Field label="Discount received">
            <MoneyInput value={discount} onChange={setDiscount} placeholder="0" />
          </Field>
        </div>
        <SummaryRows
          rows={[
            ["Amount before VAT", amount(Number.isFinite(n) ? n : 0)],
            ["Input VAT", amount(t)],
            ...(d ? ([["Discount", `−${amount(d)}`]] as Array<[ReactNode, ReactNode]>) : []),
            ["Amount owed", money(total, currency), true],
          ]}
        />
      </form>
    </Drawer>
  );
}

/* ── Payment ───────────────────────────────────────────── */

export function PaymentForm({
  supplier: preset,
  billId,
  onClose,
  onSaved,
}: {
  supplier?: Supplier;
  /** Settle this bill first. */
  billId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useSession();
  const { currency } = useCompany();
  const [picked, setPicked] = useState<Supplier | undefined>(preset);
  const [supplierId, setSupplierId] = useState(preset?.id ?? "");
  const [paymentDate, setPaymentDate] = useState(isoDay());
  const [method, setMethod] = useState<string>("BANK");
  const [paid, setPaid] = useState("");
  const [wht, setWht] = useState("");
  const [reference, setReference] = useState("");
  const [financialAccountId, setFinancialAccountId] = useState("");
  const [allocations, setAllocations] = useState<Record<string, string>>({});
  const { busy, error, setError, run } = useSubmit(onSaved);
  const bills = useOpenBills(supplierId || null);
  const open = bills.data;

  const supplier = preset ?? picked;
  const rate = toNumber(supplier?.whtRate);
  const cash = parseAmount(paid);
  const withheld = parseAmount(wht) || 0;
  const settled = (Number.isFinite(cash) ? cash : 0) + withheld;

  // Settle the chosen bill, then oldest first, whenever the amounts or bills change.
  useEffect(() => {
    if (!open) return;
    let remaining = settled;
    const ordered = billId ? [...open.filter((b) => b.id === billId), ...open.filter((b) => b.id !== billId)] : open;
    const next: Record<string, string> = {};
    for (const bill of ordered) {
      const apply = Math.min(remaining, bill.outstanding);
      if (apply > 0) next[bill.id] = amount(apply, apply % 1 ? 2 : 0);
      remaining -= apply;
    }
    setAllocations(next);
  }, [open, settled, billId]);

  const prefilled = useRef(false);
  useEffect(() => {
    if (prefilled.current || !billId || !open) return;
    prefilled.current = true;
    const bill = open.find((b) => b.id === billId);
    if (bill) setPaid(amount(bill.outstanding, bill.outstanding % 1 ? 2 : 0));
  }, [billId, open]);

  const applied = Object.values(allocations).reduce((s, v) => s + (parseAmount(v) || 0), 0);
  const unapplied = settled - applied;
  const overApplied = open?.some((b) => (parseAmount(allocations[b.id] ?? "") || 0) > b.outstanding + 0.001);
  const whtTooHigh = withheld > 0 && withheld >= settled;

  function applyRate() {
    if (settled <= 0) return;
    const tax = Math.round(settled * rate) / 100;
    setWht(amount(tax, tax % 1 ? 2 : 0));
    const rest = settled - tax;
    setPaid(amount(rest, rest % 1 ? 2 : 0));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(cash) || cash <= 0 || !supplier) return;
    if (whtTooHigh) return setError("Withholding tax must be less than the amount settled.");
    if (unapplied < -0.001) return setError("You've applied more to bills than the amount settled.");
    if (overApplied) return setError("A bill can't be settled for more than its outstanding balance.");
    const rows = Object.entries(allocations)
      .map(([id, v]) => ({ billId: id, amount: parseAmount(v) || 0 }))
      .filter((r) => r.amount > 0);
    void run(async () => {
      const p = await api<{ paymentNumber: string }>("/api/v1/ap/payments", {
        method: "POST",
        body: JSON.stringify({
          supplierId: supplier.id,
          paymentDate,
          method,
          amount: cash,
          withholdingTax: withheld || undefined,
          reference: reference.trim() || undefined,
          financialAccountId: financialAccountId || undefined,
          allocations: rows.length ? rows : undefined,
        }),
      });
      return `Payment ${p.paymentNumber} recorded`;
    });
  }

  return (
    <Drawer
      title="Pay supplier"
      subtitle="Records money paid out and clears the bills it settles."
      onClose={onClose}
      wide
      footer={<Footer onCancel={onClose} busy={busy} label="Record payment" formId="payment-form" />}
    >
      <form id="payment-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="form-grid">
          <SupplierPicker
            supplier={preset}
            supplierId={supplierId}
            onChange={(id, s) => {
              setSupplierId(id);
              setPicked(s);
              setWht("");
            }}
          />
          <Field label={`Amount paid (${currency})`} required hint="Cash leaving the bank or till">
            <MoneyInput value={paid} onChange={setPaid} required />
          </Field>
          <Field
            label="Withholding tax"
            hint={rate > 0 ? `Supplier rate: ${rate}%` : "Tax you keep and pay to RRA"}
            error={whtTooHigh ? "Must be less than the amount settled" : null}
          >
            <div className="input-action">
              <MoneyInput value={wht} onChange={setWht} placeholder="0" invalid={whtTooHigh} />
              {rate > 0 && (
                <button type="button" className="btn btn-sm" onClick={applyRate} disabled={settled <= 0} title={`Withhold ${rate}% of ${amount(settled)}`}>
                  Apply {rate}%
                </button>
              )}
            </div>
          </Field>
          <Field label="Payment date" required>
            <input className="input" type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} required />
          </Field>
          <Field label="Paid by">
            <Select value={method} onChange={setMethod} searchable={false} options={AP_METHODS} />
          </Field>
          <Field label="Reference" className="span-2" hint="Transfer ID, cheque or mobile money transaction number">
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <SettlementAccountField label="Paid from" value={financialAccountId} onChange={setFinancialAccountId} />
        </div>

        {supplierId && (
          <>
            <div className="form-section-title" style={{ marginTop: 24 }}>Settle bills</div>
            {bills.error && <p className="field-error">{bills.error}</p>}
            {!open && !bills.error && <p className="muted small">Loading open bills…</p>}
            {open && open.length === 0 && <p className="muted small">No open bills. The payment will be kept on the supplier's account as a prepayment.</p>}
            {open && open.length > 0 && (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Bill</th>
                      <th className="hide-sm">Due</th>
                      <th className="num">Outstanding</th>
                      <th className="num" style={{ width: 150 }}>
                        Settle
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {open.map((bill) => {
                      const v = allocations[bill.id] ?? "";
                      const tooMuch = (parseAmount(v) || 0) > bill.outstanding + 0.001;
                      return (
                        <tr key={bill.id}>
                          <td className="nowrap">
                            {bill.billNumber}
                            {bill.supplierInvoiceNumber && <span className="sub">Inv. {bill.supplierInvoiceNumber}</span>}
                          </td>
                          <td className="hide-sm">{date(bill.dueDate)}</td>
                          <td className="num">{amount(bill.outstanding)}</td>
                          <td style={{ padding: "5px 8px" }}>
                            <MoneyInput
                              value={v}
                              invalid={tooMuch}
                              aria-label={`Amount settled on ${bill.billNumber}`}
                              onChange={(val) => setAllocations((a) => ({ ...a, [bill.id]: val }))}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {settled > 0 && (
              <SummaryRows
                rows={[
                  ["Amount paid", amount(Number.isFinite(cash) ? cash : 0)],
                  ...(withheld ? ([["Withholding tax", amount(withheld)]] as Array<[ReactNode, ReactNode]>) : []),
                  ["Settled against bills", amount(applied)],
                  [
                    unapplied >= 0 ? "Kept on account as prepayment" : "Over-applied",
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

export function ReversePaymentForm({ payment, onClose, onSaved }: { payment: ApPayment; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const { currency } = useCompany();
  const [reversalDate, setReversalDate] = useState(isoDay());
  const [reason, setReason] = useState("");
  const { busy, error, run } = useSubmit(onSaved);
  const settled = payment.amount + payment.withholdingTax;

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      await api(`/api/v1/ap/payments/${payment.id}/reverse`, {
        method: "POST",
        body: JSON.stringify({ reversalDate, reason: reason.trim() || undefined }),
      });
      return `Payment ${payment.paymentNumber} reversed`;
    });
  }

  return (
    <Drawer
      title={`Reverse payment ${payment.paymentNumber}`}
      subtitle="Posts a reversing journal and reopens the bills it settled. This can't be undone."
      onClose={onClose}
      footer={<Footer onCancel={onClose} busy={busy} label="Reverse payment" formId="reverse-form" danger />}
    >
      <form id="reverse-form" onSubmit={submit}>
        <FormError message={error} />
        <p className="small" style={{ marginTop: 0 }}>
          {money(settled, currency)} goes back onto what you owe {payment.supplierName}
          {payment.withholdingTax > 0 && `, including ${amount(payment.withholdingTax)} withholding tax`}.
        </p>
        <div className="form-grid">
          <Field label="Reversal date" required hint="Must fall in an open period">
            <input className="input" type="date" value={reversalDate} min={payment.paymentDate.slice(0, 10)} onChange={(e) => setReversalDate(e.target.value)} required />
          </Field>
          <Field label="Reason" className="span-2">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Transfer returned by the bank" />
          </Field>
        </div>
      </form>
    </Drawer>
  );
}

/* ── Credit and debit notes ────────────────────────────── */

export function SupplierCreditNoteForm({ supplier, onClose, onSaved }: { supplier: Supplier; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const { currency } = useCompany();
  const bills = useOpenBills(supplier.id);
  const [billId, setBillId] = useState("");
  const [supplierReference, setSupplierReference] = useState("");
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
      const note = await api<{ creditNoteNumber: string }>("/api/v1/ap/credit-notes", {
        method: "POST",
        body: JSON.stringify({
          supplierId: supplier.id,
          billId: billId || undefined,
          supplierReference: supplierReference.trim() || undefined,
          noteDate,
          reason,
          net: n,
          tax: t || undefined,
        }),
      });
      return `Credit note ${note.creditNoteNumber} recorded`;
    });
  }

  return (
    <Drawer
      title="Record supplier credit note"
      subtitle={`Reduces what you owe ${supplier.name}.`}
      onClose={onClose}
      footer={<Footer onCancel={onClose} busy={busy} label="Record credit note" formId="scn-form" />}
    >
      <form id="scn-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="form-grid">
          <Field label="Against bill" className="span-2" hint="Optional — link the credit to a specific bill">
            <Select
              value={billId}
              onChange={setBillId}
              options={[
                { value: "", label: "Not linked to a bill" },
                ...(bills.data ?? []).map((b) => ({ value: b.id, label: b.billNumber, hint: `${amount(b.outstanding)} outstanding` })),
              ]}
            />
          </Field>
          <Field label="Reason" required className="span-2">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Damaged goods returned" required />
          </Field>
          <Field label="Supplier's credit note number">
            <input className="input" value={supplierReference} onChange={(e) => setSupplierReference(e.target.value)} />
          </Field>
          <Field label="Date" required>
            <input className="input" type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} required />
          </Field>
          <Field label={`Amount before VAT (${currency})`} required>
            <MoneyInput value={net} onChange={setNet} required />
          </Field>
          <Field label="Input VAT reversed">
            <MoneyInput value={tax} onChange={setTax} placeholder="0" />
          </Field>
        </div>
        <SummaryRows rows={[["Credit total", money((Number.isFinite(n) ? n : 0) + t, currency), true]]} />
      </form>
    </Drawer>
  );
}

export function SupplierDebitNoteForm({ supplier, onClose, onSaved }: { supplier: Supplier; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const { currency } = useCompany();
  const [supplierReference, setSupplierReference] = useState("");
  const [noteDate, setNoteDate] = useState(isoDay());
  const [reason, setReason] = useState("");
  const [expenseAccountId, setExpenseAccountId] = useState("");
  const [net, setNet] = useState("");
  const [tax, setTax] = useState("");
  const { busy, error, run } = useSubmit(onSaved);
  const expenseOptions = useAccountOptions(EXPENSE_TYPES, "Supplier's default account");
  const n = parseAmount(net);
  const t = parseAmount(tax) || 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(n) || n <= 0) return;
    void run(async () => {
      const note = await api<{ debitNoteNumber: string }>("/api/v1/ap/debit-notes", {
        method: "POST",
        body: JSON.stringify({
          supplierId: supplier.id,
          supplierReference: supplierReference.trim() || undefined,
          noteDate,
          dueDate: addDays(noteDate, supplier.creditPeriodDays),
          reason,
          expenseAccountId: expenseAccountId || undefined,
          net: n,
          tax: t || undefined,
        }),
      });
      return `Debit note ${note.debitNoteNumber} recorded`;
    });
  }

  return (
    <Drawer
      title="Record supplier debit note"
      subtitle={`Adds a charge to what you owe ${supplier.name}, such as freight or a price correction.`}
      onClose={onClose}
      footer={<Footer onCancel={onClose} busy={busy} label="Record debit note" formId="sdn-form" />}
    >
      <form id="sdn-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="form-grid">
          <Field label="Reason" required className="span-2">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Freight charged separately" required />
          </Field>
          <Field label="Supplier's reference">
            <input className="input" value={supplierReference} onChange={(e) => setSupplierReference(e.target.value)} />
          </Field>
          <Field label="Date" required hint={`Due ${supplier.creditPeriodDays ? `after ${supplier.creditPeriodDays} days` : "immediately"}`}>
            <input className="input" type="date" value={noteDate} onChange={(e) => setNoteDate(e.target.value)} required />
          </Field>
          <Field label="Expense account" className="span-2">
            <Select value={expenseAccountId} onChange={setExpenseAccountId} options={expenseOptions} />
          </Field>
          <Field label={`Amount before VAT (${currency})`} required>
            <MoneyInput value={net} onChange={setNet} required />
          </Field>
          <Field label="Input VAT">
            <MoneyInput value={tax} onChange={setTax} placeholder="0" />
          </Field>
        </div>
        <SummaryRows rows={[["Added to balance", money((Number.isFinite(n) ? n : 0) + t, currency), true]]} />
      </form>
    </Drawer>
  );
}

/* ── Advances ──────────────────────────────────────────── */

export function AdvanceForm({ supplier, onClose, onSaved }: { supplier: Supplier; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const { currency } = useCompany();
  const [advanceDate, setAdvanceDate] = useState(isoDay());
  const [method, setMethod] = useState<string>("BANK");
  const [value, setValue] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const { busy, error, run } = useSubmit(onSaved);

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = parseAmount(value);
    if (!Number.isFinite(n) || n <= 0) return;
    void run(async () => {
      const adv = await api<{ advanceNumber: string }>("/api/v1/ap/advances", {
        method: "POST",
        body: JSON.stringify({
          supplierId: supplier.id,
          advanceDate,
          method,
          amount: n,
          reference: reference.trim() || undefined,
          description: description.trim() || undefined,
        }),
      });
      return `Advance ${adv.advanceNumber} recorded`;
    });
  }

  return (
    <Drawer
      title="Pay supplier in advance"
      subtitle="Money paid before goods or services arrive, held until it's applied to a bill."
      onClose={onClose}
      footer={<Footer onCancel={onClose} busy={busy} label="Record advance" formId="advance-form" />}
    >
      <form id="advance-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="form-grid">
          <Field label={`Amount (${currency})`} required>
            <MoneyInput value={value} onChange={setValue} required />
          </Field>
          <Field label="Date paid" required>
            <input className="input" type="date" value={advanceDate} onChange={(e) => setAdvanceDate(e.target.value)} required />
          </Field>
          <Field label="Paid by">
            <Select value={method} onChange={setMethod} searchable={false} options={AP_METHODS} />
          </Field>
          <Field label="Reference">
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field label="Description" className="span-2">
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. 30% deposit on PO-114" />
          </Field>
        </div>
      </form>
    </Drawer>
  );
}

export function AllocateAdvanceForm({ advance, onClose, onSaved }: { advance: ApAdvance; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const { currency } = useCompany();
  const bills = useOpenBills(advance.supplierId);
  const [billId, setBillId] = useState("");
  const [value, setValue] = useState("");
  const [allocationDate, setAllocationDate] = useState(isoDay());
  const { busy, error, run } = useSubmit(onSaved);
  const bill = bills.data?.find((b) => b.id === billId);
  const n = parseAmount(value);
  const tooMuch = Number.isFinite(n) && (n > advance.remaining + 0.001 || (bill ? n > bill.outstanding + 0.001 : false));

  function pick(id: string) {
    setBillId(id);
    const b = bills.data?.find((x) => x.id === id);
    if (b) {
      const v = Math.min(b.outstanding, advance.remaining);
      setValue(amount(v, v % 1 ? 2 : 0));
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!billId || !Number.isFinite(n) || n <= 0 || tooMuch) return;
    void run(async () => {
      await api(`/api/v1/ap/advances/${advance.id}/allocate`, { method: "POST", body: JSON.stringify({ billId, amount: n, allocationDate }) });
      return `${money(n, currency)} of ${advance.advanceNumber} applied`;
    });
  }

  return (
    <Drawer
      title={`Apply advance ${advance.advanceNumber}`}
      subtitle={`${money(advance.remaining, currency)} still available.`}
      onClose={onClose}
      footer={<Footer onCancel={onClose} busy={busy} label="Apply advance" formId="alloc-form" />}
    >
      <form id="alloc-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="form-grid">
          <Field label="Bill" required className="span-2">
            <Select
              value={billId}
              onChange={pick}
              required
              placeholder="Select a bill…"
              emptyText="This supplier has no open bills"
              options={(bills.data ?? []).map((b) => ({ value: b.id, label: b.billNumber, hint: `${amount(b.outstanding)} outstanding` }))}
            />
          </Field>
          <Field label={`Amount (${currency})`} required error={tooMuch ? "More than the advance or the bill balance" : null}>
            <MoneyInput value={value} onChange={setValue} invalid={tooMuch} required />
          </Field>
          <Field label="Date" required hint="Must fall in an open period">
            <input className="input" type="date" value={allocationDate} onChange={(e) => setAllocationDate(e.target.value)} required />
          </Field>
        </div>
      </form>
    </Drawer>
  );
}

export function RefundAdvanceForm({ advance, onClose, onSaved }: { advance: ApAdvance; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const { currency } = useCompany();
  const [value, setValue] = useState(amount(advance.remaining, advance.remaining % 1 ? 2 : 0));
  const [method, setMethod] = useState<string>(advance.method);
  const [refundDate, setRefundDate] = useState(isoDay());
  const { busy, error, run } = useSubmit(onSaved);
  const n = parseAmount(value);
  const tooMuch = Number.isFinite(n) && n > advance.remaining + 0.001;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(n) || n <= 0 || tooMuch) return;
    void run(async () => {
      await api(`/api/v1/ap/advances/${advance.id}/refund`, { method: "POST", body: JSON.stringify({ amount: n, method, refundDate }) });
      return `Refund of ${money(n, currency)} recorded`;
    });
  }

  return (
    <Drawer
      title={`Record refund of ${advance.advanceNumber}`}
      subtitle="The supplier returned unused advance money."
      onClose={onClose}
      footer={<Footer onCancel={onClose} busy={busy} label="Record refund" formId="refund-form" />}
    >
      <form id="refund-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="form-grid">
          <Field label={`Amount refunded (${currency})`} required error={tooMuch ? `Only ${amount(advance.remaining)} is available` : null}>
            <MoneyInput value={value} onChange={setValue} invalid={tooMuch} required />
          </Field>
          <Field label="Date received" required>
            <input className="input" type="date" value={refundDate} onChange={(e) => setRefundDate(e.target.value)} required />
          </Field>
          <Field label="Received into">
            <Select value={method} onChange={setMethod} searchable={false} options={AP_METHODS} />
          </Field>
        </div>
      </form>
    </Drawer>
  );
}
