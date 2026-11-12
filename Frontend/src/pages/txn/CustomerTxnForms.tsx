import { Printer, RefreshCw, SlidersHorizontal } from "lucide-react";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AddCustomerDrawer } from "../../components/customers/AddCustomerDrawer";
import { useFeedback } from "../../components/feedback";
import { Select } from "../../components/Select";
import {
  emptyProductLine,
  fmt,
  num,
  previewLines,
  type ProductLine,
  productColumns,
  productLinesPayload,
  productLinesSchema,
  productTotal,
} from "../../components/txn/lines";
import {
  AttachmentBox,
  CancelButton,
  DocPreview,
  ErrorBanner,
  HeaderBand,
  LineGrid,
  Modal,
  PartySelect,
  type PickedFile,
  RecurringModal,
  SplitButton,
  TextArea,
  TField,
  Totals,
  TxnFooter,
  TxnPage,
  uploadAttachments,
  useValidation,
  ValidationSummary,
} from "../../components/txn/TxnKit";
import { financialAccountOptions, useFinancialAccounts } from "../../lib/banking";
import { useCompany } from "../../lib/company";
import { amount, date, isoDay } from "../../lib/format";
import { navigate, useLocation } from "../../lib/router";
import { useResource, useSession } from "../../lib/session";
import {
  AR_METHODS,
  customerOptions,
  emailListValid,
  indexTxn,
  peekNumber,

  rwf,
  takeNumber,
  toBankMethod,
  type TxnKind,
  useCustomers,
  useProductOptions,
} from "../../lib/txn";
import type { ArInvoiceList, Customer } from "../../lib/types";
import { yup } from "../../lib/validation";

/* ── Shared bits ───────────────────────────────────────── */

type EmailState = { email: string; cc: string; bcc: string; sendLater: boolean };
const emptyEmail = (): EmailState => ({ email: "", cc: "", bcc: "", sendLater: false });

const emailSchema = {
  email: yup
    .string()
    .test("emails", "Enter valid emails, separated by commas", (v) => !v || emailListValid(v))
    .test("needed", "Add an email to send later", function (v) {
      return !this.parent.sendLater || Boolean(v?.trim());
    }),
  cc: yup.string().test("emails", "Enter valid emails, separated by commas", (v) => !v || emailListValid(v)),
  bcc: yup.string().test("emails", "Enter valid emails, separated by commas", (v) => !v || emailListValid(v)),
};

function EmailFields({ value, onChange, errors, sendLater = true }: { value: EmailState; onChange: (v: EmailState) => void; errors: Record<string, string | undefined>; sendLater?: boolean }) {
  const [ccOpen, setCcOpen] = useState(Boolean(value.cc || value.bcc));
  return (
    <div style={{ display: "grid", gap: 10 }} className="w-lg">
      <TField
        label="Email"
        error={errors.email}
        aside={
          <button type="button" className="txn-link txn-label-aside" onClick={() => setCcOpen((o) => !o)}>
            Cc/Bcc
          </button>
        }
      >
        <input className="txn-input" value={value.email} placeholder="Email (Separate emails with a comma)" onChange={(e) => onChange({ ...value, email: e.target.value })} />
      </TField>
      {ccOpen ? (
        <>
          <TField label="Cc" error={errors.cc}>
            <input className="txn-input" value={value.cc} onChange={(e) => onChange({ ...value, cc: e.target.value })} />
          </TField>
          <TField label="Bcc" error={errors.bcc}>
            <input className="txn-input" value={value.bcc} onChange={(e) => onChange({ ...value, bcc: e.target.value })} />
          </TField>
        </>
      ) : null}
      {sendLater ? (
        <label className="txn-check">
          <input type="checkbox" checked={value.sendLater} onChange={(e) => onChange({ ...value, sendLater: e.target.checked })} /> Send later
        </label>
      ) : null}
    </div>
  );
}

function CustomerField({ value, onPick, error, label = "Customer" }: { value: string; onPick: (c: Customer | undefined) => void; error?: string; label?: string }) {
  const { customers, reload } = useCustomers();
  const [adding, setAdding] = useState(false);
  return (
    <TField label={label} required error={error} className="w-lg">
      <PartySelect
        value={value}
        onChange={(id) => onPick(customers.find((c) => c.id === id))}
        options={customerOptions(customers)}
        placeholder="Choose a customer"
        invalid={Boolean(error)}
        addLabel="Add new customer"
        onAdd={() => setAdding(true)}
      />
      {adding ? (
        <AddCustomerDrawer
          onClose={() => setAdding(false)}
          onSaved={(c) => {
            setAdding(false);
            reload();
            onPick(c);
          }}
        />
      ) : null}
    </TField>
  );
}

function PreviewModal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return (
    <Modal
      title="Print preview"
      onClose={onClose}
      width={940}
      footer={
        <>
          <button type="button" className="txn-btn-outline blue" onClick={onClose}>
            Close
          </button>
          <button type="button" className="txn-btn-primary" onClick={() => window.print()}>
            <Printer size={18} style={{ verticalAlign: "-3px", marginRight: 8 }} />
            Print
          </button>
        </>
      }
    >
      {children}
    </Modal>
  );
}

function Privacy() {
  return (
    <p className="txn-privacy">
      <button type="button" className="txn-link" onClick={() => navigate("/settings/advanced")}>
        Privacy
      </button>
    </p>
  );
}

/* ── Receive payment ───────────────────────────────────── */

export function ReceivePaymentForm() {
  const { api } = useSession();
  const { toast } = useFeedback();
  const { currency } = useCompany();
  const banks = useFinancialAccounts();
  const v = useValidation();
  const blank = () => ({ customerId: "", ...emptyEmail(), paymentDate: isoDay(), method: "", reference: "", depositTo: "", amountReceived: "", memo: "" });
  const [form, setForm] = useState(blank);
  const [customer, setCustomer] = useState<Customer>();
  const [applied, setApplied] = useState<Record<string, string>>({});
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [finder, setFinder] = useState(false);
  const [preview, setPreview] = useState(false);
  const open = useResource<ArInvoiceList>(form.customerId ? `/api/v1/ar/invoices?status=OPEN&customerId=${form.customerId}&pageSize=500` : null);
  const invoices = useMemo(() => [...(open.data?.rows ?? [])].sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [open.data]);

  const received = num(form.amountReceived);
  const appliedTotal = Object.values(applied).reduce((s, x) => s + num(x), 0);

  // Spread the amount received across open invoices, oldest due first.
  useEffect(() => {
    let left = received;
    const next: Record<string, string> = {};
    for (const inv of invoices) {
      const take = Math.min(left, inv.outstanding);
      if (take > 0) next[inv.id] = fmt(take);
      left -= take;
    }
    setApplied(next);
  }, [received, invoices]);

  const set = (k: keyof ReturnType<typeof blank>, val: string | boolean) => (setForm((f) => ({ ...f, [k]: val })), v.clear(k));

  const schema = yup.object({
    customerId: yup.string().required("Choose a customer"),
    ...emailSchema,
    paymentDate: yup.string().required("Choose the payment date"),
    method: yup.string().required("Choose a payment method"),
    reference: yup.string().max(120, "Use 120 characters or fewer"),
    amountReceived: yup
      .string()
      .test("amt", "Enter the amount received", (val) => num(val ?? "") > 0)
      .test("applied", "You've applied more to invoices than you received", () => appliedTotal <= received + 0.001),
    memo: yup.string().max(1000, "Use 1,000 characters or fewer"),
  });

  async function save(after: "stay" | "new" | "close") {
    setError("");
    const over = invoices.find((i) => num(applied[i.id] ?? "") > i.outstanding + 0.001);
    if (over) return setError(`Invoice ${over.invoiceNumber} only has ${rwf(over.outstanding, currency)} outstanding.`);
    if (!(await v.validate(schema, form))) return;
    setBusy(true);
    try {
      const allocations = Object.entries(applied)
        .map(([invoiceId, x]) => ({ invoiceId, amount: num(x) }))
        .filter((a) => a.amount > 0);
      const r = await api<{ id?: string; receiptNumber: string }>("/api/v1/ar/receipts", {
        method: "POST",
        body: JSON.stringify({
          customerId: form.customerId,
          receiptDate: form.paymentDate,
          method: form.method,
          amount: received,
          reference: form.reference.trim() || undefined,
          description: form.memo.trim() || undefined,
          financialAccountId: form.depositTo || undefined,
          allocations: allocations.length ? allocations : undefined,
          allowOverpayment: appliedTotal < received ? true : undefined,
        }),
      });
      indexTxn({ id: r.id, kind: "payment", number: r.receiptNumber, date: form.paymentDate, party: customer?.name ?? "", amount: received, memo: form.memo, status: "Posted", posted: true });
      toast(`Payment ${r.receiptNumber} recorded${appliedTotal < received ? ` — ${rwf(received - appliedTotal, currency)} left as credit` : ""}`);
      if (after === "close") return navigate("/invoices");
      setForm(blank());
      setCustomer(undefined);
      setFiles([]);
      open.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const ready = Boolean(form.customerId);
  return (
    <TxnPage
      title="Receive Payment"
      kind="payment"
      onClose={() => navigate("/invoices")}
      actions={["feedback", "help", "close"]}
      footer={
        <TxnFooter
          left={<CancelButton tone="blue" onClick={() => navigate("/invoices")} />}
          center={
            <button type="button" className="txn-foot-link" disabled={!ready} onClick={() => setPreview(true)}>
              <Printer size={22} /> Print
            </button>
          }
          right={
            <>
              <SplitButton label="Save" variant="secondary" onClick={() => void save("stay")} disabled={!ready} busy={busy} />
              <SplitButton label="Save and close" onClick={() => void save("close")} disabled={!ready} busy={busy} items={[{ label: "Save and new", onSelect: () => void save("new") }]} />
            </>
          }
        />
      }
    >
      <ErrorBanner message={error} onClose={() => setError("")} />
      <ValidationSummary count={v.count} />
      <HeaderBand
        collapsible={false}
        amountLabel="Amount received"
        amountValue={rwf(received, currency)}
        aside={
          <span style={{ marginTop: 10, fontWeight: 600 }}>
            Customer balance
            <br />
            <span style={{ fontWeight: 450 }}>{rwf(Number(customer?.balance ?? 0), currency)}</span>
          </span>
        }
      >
        <div className="txn-row">
          <CustomerField
            value={form.customerId}
            error={v.errors.customerId}
            onPick={(c) => {
              setCustomer(c);
              setForm((f) => ({ ...f, customerId: c?.id ?? "", email: c?.email ?? f.email }));
              v.clear("customerId");
            }}
          />
          <EmailFields value={form} onChange={(e) => setForm((f) => ({ ...f, ...e }))} errors={v.errors} />
          <button type="button" className="txn-btn-outline" style={{ marginTop: 28, fontWeight: 700 }} onClick={() => setFinder(true)}>
            Find by invoice no.
          </button>
        </div>
        <div className="txn-row">
          <TField label="Payment Date" required error={v.errors.paymentDate} className="w-md">
            <input className="txn-input" type="date" value={form.paymentDate} onChange={(e) => set("paymentDate", e.target.value)} />
          </TField>
        </div>
        <div className="txn-row" style={{ alignItems: "flex-end" }}>
          <TField label="Payment method" required error={v.errors.method} className="w-md">
            <Select value={form.method} onChange={(m) => set("method", m)} options={AR_METHODS} placeholder="Choose payment method" searchable={false} invalid={Boolean(v.errors.method)} />
          </TField>
          <TField label="Reference no." error={v.errors.reference} className="w-md">
            <input className="txn-input" value={form.reference} onChange={(e) => set("reference", e.target.value)} />
          </TField>
          <TField label="Deposit To" className="w-md" hint={!banks.data?.length ? "Uses the default account for the payment method" : undefined}>
            <Select value={form.depositTo} onChange={(a) => set("depositTo", a)} options={financialAccountOptions(banks.data ?? [])} placeholder="Choose an account" />
          </TField>
          <TField label="Amount received" required error={v.errors.amountReceived} className="w-md" >
            <input
              className="txn-input num"
              inputMode="decimal"
              value={form.amountReceived}
              placeholder={`${currency} 0.00`}
              onChange={(e) => set("amountReceived", e.target.value.replace(/[^\d.,]/g, ""))}
              onBlur={() => received && set("amountReceived", fmt(received))}
            />
          </TField>
        </div>
      </HeaderBand>

      {form.customerId ? (
        <section style={{ marginBottom: 26 }}>
          <h3 style={{ fontSize: 20, margin: "0 0 8px" }}>Outstanding transactions</h3>
          {open.loading ? (
            <p className="muted">Loading open invoices…</p>
          ) : invoices.length === 0 ? (
            <p className="muted">This customer has no open invoices. The payment will be kept as a credit on their account.</p>
          ) : (
            <table className="txn-table">
              <thead>
                <tr>
                  <th style={{ width: 40 }} />
                  <th>Description</th>
                  <th>Due date</th>
                  <th className="right">Original amount</th>
                  <th className="right">Open balance</th>
                  <th className="right" style={{ width: 200 }}>
                    Payment
                  </th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => {
                  const val = applied[inv.id] ?? "";
                  const tooMuch = num(val) > inv.outstanding + 0.001;
                  return (
                    <tr key={inv.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Apply to invoice ${inv.invoiceNumber}`}
                          checked={num(val) > 0}
                          onChange={(e) => setApplied((a) => ({ ...a, [inv.id]: e.target.checked ? fmt(inv.outstanding) : "" }))}
                        />
                      </td>
                      <td>
                        Invoice # {inv.invoiceNumber} ({date(inv.invoiceDate)})
                      </td>
                      <td>{date(inv.dueDate)}</td>
                      <td className="right">{amount(inv.gross, 2)}</td>
                      <td className="right">{amount(inv.outstanding, 2)}</td>
                      <td className="right">
                        <input
                          className={`txn-input num ${tooMuch ? "invalid" : ""}`}
                          value={val}
                          title={tooMuch ? "More than the open balance" : undefined}
                          aria-label={`Payment for invoice ${inv.invoiceNumber}`}
                          onChange={(e) => setApplied((a) => ({ ...a, [inv.id]: e.target.value.replace(/[^\d.,]/g, "") }))}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5}>Amount to apply</td>
                  <td className="right">{rwf(appliedTotal, currency)}</td>
                </tr>
              </tfoot>
            </table>
          )}
          {received > appliedTotal + 0.001 && invoices.length ? (
            <p className="muted">Amount to credit: {rwf(received - appliedTotal, currency)}</p>
          ) : null}
        </section>
      ) : null}

      <div className="txn-lower-left">
        <TextArea label="Memo" value={form.memo} onChange={(t) => set("memo", t)} placeholder="Note" error={v.errors.memo} />
        <TField label="Attachments">
          <AttachmentBox files={files} onChange={setFiles} />
        </TField>
      </div>
      {files.length ? <p className="muted">Receipts don't store files yet — keep these with the invoice they pay.</p> : null}
      <Privacy />

      {finder ? (
        <FindInvoiceModal
          onClose={() => setFinder(false)}
          onFound={(c, invoiceAmount) => {
            setFinder(false);
            setCustomer(c);
            setForm((f) => ({ ...f, customerId: c.id, email: c.email ?? f.email, amountReceived: fmt(invoiceAmount) }));
          }}
        />
      ) : null}
      {preview ? (
        <PreviewModal onClose={() => setPreview(false)}>
          <DocPreview
            mode="pdf"
            docTitle="Payment"
            number={form.reference}
            party={customer?.name ?? ""}
            dates={[["Payment date", form.paymentDate]]}
            lines={invoices.filter((i) => num(applied[i.id] ?? "") > 0).map((i) => ({ description: `Invoice ${i.invoiceNumber}`, amount: num(applied[i.id]) }))}
            totals={[["Amount received", rwf(received, currency)]]}
            note={form.memo}
          />
        </PreviewModal>
      ) : null}
    </TxnPage>
  );
}

function FindInvoiceModal({ onClose, onFound }: { onClose: () => void; onFound: (c: Customer, outstanding: number) => void }) {
  const { api } = useSession();
  const [no, setNo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function find() {
    if (!no.trim()) return setError("Enter an invoice number");
    setBusy(true);
    setError("");
    try {
      const list = await api<ArInvoiceList>(`/api/v1/ar/invoices?status=OPEN&q=${encodeURIComponent(no.trim())}&pageSize=20`);
      const hit = list.rows.find((r) => r.invoiceNumber.toLowerCase() === no.trim().toLowerCase()) ?? list.rows[0];
      if (!hit) return setError("No open invoice has that number");
      const c = await api<Customer>(`/api/v1/ar/customers/${hit.customerId}`);
      onFound(c, hit.outstanding);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Find by invoice no."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="txn-btn-outline blue" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="txn-btn-primary" onClick={() => void find()} disabled={busy}>
            {busy ? "Finding…" : "Find"}
          </button>
        </>
      }
    >
      <TField label="Invoice no." required error={error || undefined}>
        <input className="txn-input" value={no} autoFocus onChange={(e) => (setNo(e.target.value), setError(""))} onKeyDown={(e) => e.key === "Enter" && void find()} />
      </TField>
    </Modal>
  );
}

/* ── Line-based customer forms ─────────────────────────── */

type LineKind = "credit-note" | "sales-receipt" | "refund-receipt" | "delayed-credit" | "delayed-charge";

const CONFIG: Record<
  LineKind,
  {
    title: string;
    amountLabel: string;
    dateLabel: string;
    numberLabel: string;
    message?: string;
    email: boolean;
    sendLater: boolean;
    billing: boolean;
    payment: boolean;
    accountLabel?: string;
    local: boolean;
    sequenceStart: number;
  }
> = {
  "credit-note": { title: "Credit Note", amountLabel: "Amount to credit", dateLabel: "Credit Note Date", numberLabel: "Credit Note no.", message: "credit note", email: true, sendLater: true, billing: true, payment: false, local: false, sequenceStart: 1001 },
  "sales-receipt": { title: "Sales Receipt", amountLabel: "Amount", dateLabel: "Sales Receipt Date", numberLabel: "Sales Receipt no.", message: "sales receipt", email: true, sendLater: true, billing: true, payment: true, accountLabel: "Deposit To", local: false, sequenceStart: 1001 },
  "refund-receipt": { title: "Refund Receipt", amountLabel: "Amount to refund", dateLabel: "Refund Receipt Date", numberLabel: "Refund Receipt no.", message: "refund receipt", email: true, sendLater: false, billing: true, payment: true, accountLabel: "Refund From", local: false, sequenceStart: 1001 },
  "delayed-credit": { title: "Delayed Credit", amountLabel: "Amount", dateLabel: "Delayed Credit Date", numberLabel: "Delayed Credit no.", email: false, sendLater: false, billing: false, payment: false, local: true, sequenceStart: 1 },
  "delayed-charge": { title: "Delayed Charge", amountLabel: "Amount", dateLabel: "Delayed Charge Date", numberLabel: "Delayed Charge no.", email: false, sendLater: false, billing: false, payment: false, local: true, sequenceStart: 1 },
};

type LineForm = EmailState & {
  customerId: string;
  billing: string;
  date: string;
  number: string;
  method: string;
  reference: string;
  account: string;
  message: string;
  statementMessage: string;
  memo: string;
  lines: ProductLine[];
};

export function CustomerLineForm({ kind }: { kind: LineKind }) {
  const cfg = CONFIG[kind];
  const { api } = useSession();
  const { toast } = useFeedback();
  const { currency } = useCompany();
  const { query } = useLocation();
  const banks = useFinancialAccounts();
  const { options: productOptions, items } = useProductOptions();
  const v = useValidation();
  const blank = (): LineForm => ({
    customerId: "",
    ...emptyEmail(),
    billing: "",
    date: isoDay(),
    number: peekNumber(kind, cfg.sequenceStart),
    method: "",
    reference: "",
    account: "",
    message: "",
    statementMessage: "",
    memo: "",
    lines: [emptyProductLine(), emptyProductLine()],
  });
  const [form, setForm] = useState<LineForm>(blank);
  const [customer, setCustomer] = useState<Customer>();
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [preview, setPreview] = useState(false);
  const [customise, setCustomise] = useState(false);
  const [showDate, setShowDate] = useState(true);

  const total = productTotal(form.lines);
  const set = <K extends keyof LineForm>(k: K, val: LineForm[K]) => (setForm((f) => ({ ...f, [k]: val })), v.clear(k));

  const schema = yup.object({
    customerId: yup.string().required("Choose a customer"),
    ...(cfg.email ? emailSchema : {}),
    date: yup.string().required("Choose a date"),
    number: yup.string().trim().required("Enter a number").max(21, "Use 21 characters or fewer"),
    method: cfg.payment ? yup.string().required("Choose a payment method") : yup.string(),
    account:
      kind === "refund-receipt" ? yup.string().required("Choose the account the refund comes from") : yup.string(),
    reference: yup.string().max(120, "Use 120 characters or fewer"),
    message: yup.string().max(1000, "Use 1,000 characters or fewer"),
    statementMessage: yup.string().max(1000, "Use 1,000 characters or fewer"),
    memo: yup.string().max(1000, "Use 1,000 characters or fewer"),
    lines: productLinesSchema({ requireAccount: kind === "refund-receipt" }),
  });

  async function post(): Promise<{ id: string; number: string; posted: boolean }> {
    const lines = productLinesPayload(form.lines, productOptions);
    const description = form.statementMessage.trim() || form.memo.trim() || undefined;
    if (kind === "credit-note") {
      const note = await api<{ id: string; creditNoteNumber: string }>("/api/v1/ar/credit-notes", {
        method: "POST",
        body: JSON.stringify({ customerId: form.customerId, noteDate: form.date, reason: form.message.trim() || "Customer credit", net: Math.round(total * 100) / 100, description: description ?? lines.map((l) => l.description).join("; ").slice(0, 500) }),
      });
      return { id: note.id, number: note.creditNoteNumber, posted: true };
    }
    if (kind === "sales-receipt") {
      const inv = await api<{ id: string; invoiceNumber: string }>("/api/v1/ar/invoices", {
        method: "POST",
        body: JSON.stringify({ customerId: form.customerId, invoiceDate: form.date, dueDate: form.date, lines, description: form.message.trim() || description }),
      });
      if (files.length) await uploadAttachments(api, "ArInvoice", inv.id, files);
      try {
        await api("/api/v1/ar/receipts", {
          method: "POST",
          body: JSON.stringify({
            customerId: form.customerId,
            receiptDate: form.date,
            method: form.method,
            amount: Math.round(total * 100) / 100,
            reference: form.reference.trim() || undefined,
            financialAccountId: form.account || undefined,
            allocations: [{ invoiceId: inv.id, amount: Math.round(total * 100) / 100 }],
          }),
        });
      } catch (e) {
        throw new Error(`Sale ${inv.invoiceNumber} was posted, but the payment couldn't be recorded: ${(e as Error).message}. Record it with Receive payment.`);
      }
      return { id: inv.id, number: inv.invoiceNumber, posted: true };
    }
    if (kind === "refund-receipt") {
      const t = await api<{ id: string; number?: string; reference?: string }>("/api/v1/banking/payments", {
        method: "POST",
        body: JSON.stringify({
          financialAccountId: form.account,
          transactionDate: form.date,
          method: toBankMethod(form.method),
          reference: form.reference.trim() || `Refund ${form.number}`,
          partyType: "CUSTOMER",
          partyName: customer?.name,
          description: form.message.trim() || `Refund to ${customer?.name ?? "customer"}`,
          lines: lines.map((l) => ({ accountId: l.accountId!, amount: Math.round(l.quantity * l.unitPrice * 100) / 100, description: l.description.slice(0, 300) })),
        }),
      });
      return { id: t.id, number: t.number ?? form.number, posted: true };
    }
    const doc = await api<{ id: string; number: string }>(`/api/v1/commercial/${kind}`, {
      method: "POST",
      body: JSON.stringify({ number: form.number, customerId: form.customerId, docDate: form.date, memo: form.memo, note: form.message, lines }),
    });
    takeNumber(kind, doc.number, cfg.sequenceStart);
    return { id: doc.id, number: doc.number, posted: false };
  }

  async function save(after: "stay" | "new" | "close" | "send") {
    setError("");
    if (!(await v.validate(schema, form))) return;
    setBusy(true);
    try {
      const result = await post();
      if (!cfg.local) takeNumber(kind, form.number, cfg.sequenceStart);
      indexTxn({
        id: result.id,
        kind: kind as TxnKind,
        number: result.number,
        date: form.date,
        party: customer?.name ?? "",
        amount: total,
        memo: form.memo || form.message,
        status: result.posted ? "Posted" : "Open",
        projectId: query.get("project") ?? undefined,
        posted: result.posted,
      });
      toast(`${cfg.title} ${result.number} ${result.posted ? "posted" : "saved"}`);
      if (after === "send" && form.email.trim()) {
        const subject = `${cfg.title} ${result.number}`;
        window.location.href = `mailto:${encodeURIComponent(form.email)}?cc=${encodeURIComponent(form.cc)}&bcc=${encodeURIComponent(form.bcc)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${form.message}\n\nTotal: ${rwf(total, currency)}`)}`;
      }
      if (after === "close") return navigate("/invoices");
      setForm(blank());
      setCustomer(undefined);
      setFiles([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const columns = productColumns(productOptions, items, { date: showDate });
  const saveDisabled = kind === "refund-receipt" && !form.customerId;

  const footerRight = (() => {
    switch (kind) {
      case "credit-note":
        return <SplitButton label="Save and send" onClick={() => void save("send")} busy={busy} items={[{ label: "Save and new", onSelect: () => void save("new") }, { label: "Save and close", onSelect: () => void save("close") }]} />;
      case "sales-receipt":
        return (
          <>
            <SplitButton label="Save" variant="secondary" onClick={() => void save("stay")} busy={busy} />
            <SplitButton label="Save and close" onClick={() => void save("close")} busy={busy} items={[{ label: "Save and new", onSelect: () => void save("new") }, { label: "Save and send", onSelect: () => void save("send") }]} />
          </>
        );
      case "refund-receipt":
        return (
          <>
            <SplitButton label="Save" variant="secondary" onClick={() => void save("stay")} busy={busy} />
            <SplitButton label="Save and new" onClick={() => void save("new")} busy={busy} disabled={saveDisabled} items={[{ label: "Save and close", onSelect: () => void save("close") }]} />
          </>
        );
      default:
        return <SplitButton label="Save and new" onClick={() => void save("new")} busy={busy} disabled={!form.customerId} items={[{ label: "Save and close", onSelect: () => void save("close") }]} />;
    }
  })();

  const isDelayed = kind === "delayed-credit" || kind === "delayed-charge";
  return (
    <TxnPage
      title={`${cfg.title} #${form.number}`}
      kind={kind as TxnKind}
      onClose={() => navigate("/invoices")}
      actions={["feedback", "settings", "help", "close"]}
      footer={
        <TxnFooter
          left={<CancelButton onClick={() => navigate("/invoices")} />}
          center={
            <>
              {!isDelayed ? (
                <>
                  <button type="button" className="txn-foot-link" onClick={() => setPreview(true)}>
                    <Printer size={22} /> Print or Preview
                  </button>
                  <span className="txn-vsep" />
                </>
              ) : null}
              <button type="button" className="txn-foot-link" onClick={() => setRecurring(true)}>
                <RefreshCw size={22} /> Make recurring
              </button>
              {kind === "sales-receipt" ? (
                <>
                  <span className="txn-vsep" />
                  <button type="button" className="txn-foot-link" onClick={() => setCustomise(true)}>
                    <SlidersHorizontal size={22} /> Customise
                  </button>
                </>
              ) : null}
            </>
          }
          right={footerRight}
        />
      }
    >
      <ErrorBanner message={error} onClose={() => setError("")} />
      <ValidationSummary count={v.count} />
      <HeaderBand amountLabel={cfg.amountLabel} amountValue={rwf(total, currency)} summary={customer ? `${customer.name} · ${date(form.date)}` : "No customer chosen"}>
        <div className="txn-row">
          <CustomerField
            value={form.customerId}
            error={v.errors.customerId}
            onPick={(c) => {
              setCustomer(c);
              setForm((f) => ({ ...f, customerId: c?.id ?? "", email: c?.email ?? f.email, billing: c ? [c.name, c.physicalAddress].filter(Boolean).join("\n") : f.billing }));
              v.clear("customerId");
            }}
          />
          {cfg.email ? <EmailFields value={form} onChange={(e) => setForm((f) => ({ ...f, ...e }))} errors={v.errors} sendLater={cfg.sendLater} /> : null}
        </div>
        <div className="txn-row" style={{ justifyContent: "space-between" }}>
          <div className="txn-row" style={{ margin: 0 }}>
            {cfg.billing ? (
              <TField label="Billing Address" className="w-lg">
                <textarea className="txn-textarea addr" value={form.billing} onChange={(e) => set("billing", e.target.value)} />
              </TField>
            ) : null}
            <TField label={cfg.dateLabel} required error={v.errors.date} className={isDelayed ? "w-lg" : "w-sm"}>
              <input className="txn-input" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
            </TField>
          </div>
          <TField label={cfg.numberLabel} required error={v.errors.number} className="w-md" hint={!cfg.local ? "Final number is assigned when it posts" : undefined}>
            <input className="txn-input" value={form.number} onChange={(e) => set("number", e.target.value)} />
          </TField>
        </div>
        {cfg.payment ? (
          <div className="txn-row">
            <TField label="Payment method" required error={v.errors.method} className="w-lg">
              <Select value={form.method} onChange={(m) => set("method", m)} options={AR_METHODS} placeholder="Choose payment method" searchable={false} invalid={Boolean(v.errors.method)} />
            </TField>
            {kind === "sales-receipt" ? (
              <TField label="Reference no." error={v.errors.reference} className="w-lg">
                <input className="txn-input" value={form.reference} onChange={(e) => set("reference", e.target.value)} />
              </TField>
            ) : null}
            <TField label={cfg.accountLabel!} required={kind === "refund-receipt"} error={v.errors.account} className="w-lg">
              <Select
                value={form.account}
                onChange={(a) => set("account", a)}
                options={financialAccountOptions(banks.data ?? [])}
                placeholder={kind === "sales-receipt" ? "Cash and cash equivalents" : "Choose an account"}
                invalid={Boolean(v.errors.account)}
              />
            </TField>
          </div>
        ) : null}
      </HeaderBand>

      <LineGrid
        columns={columns}
        rows={form.lines}
        onChange={(rows) => set("lines", rows)}
        newRow={emptyProductLine}
        errors={v.errors}
        copy={false}
        minRows={1}
      />
      {kind === "refund-receipt" ? <p className="muted" style={{ marginTop: -12 }}>Refund lines post against the income account chosen as the product/service.</p> : null}

      <div className="txn-lower">
        <div className="txn-lower-left" style={{ width: "min(620px, 100%)" }}>
          {isDelayed ? (
            <TextArea label="Memo" value={form.memo} onChange={(t) => set("memo", t)} error={v.errors.memo} />
          ) : (
            <>
              <TextArea className="txn-label-light" label={`Message displayed on ${cfg.message}`} value={form.message} onChange={(t) => set("message", t)} error={v.errors.message} />
              <TextArea className="txn-label-light" label="Message displayed on statement" value={form.statementMessage} onChange={(t) => set("statementMessage", t)} error={v.errors.statementMessage} />
            </>
          )}
          <TField label="Attachments" className={isDelayed ? "" : "txn-label-light"}>
            <AttachmentBox files={files} onChange={setFiles} dashed={false} />
          </TField>
        </div>
        <div className="txn-lower-right">
          <Totals
            rows={
              kind === "credit-note"
                ? [
                    { label: "Subtotal", value: rwf(total, currency) },
                    { label: "Total", value: rwf(total, currency), strong: true },
                    { label: "Total Credit", value: rwf(total, currency) },
                  ]
                : kind === "sales-receipt"
                  ? [
                      { label: "Subtotal", value: rwf(total, currency) },
                      { label: "Total", value: rwf(total, currency), strong: true },
                      { label: "Amount received", value: rwf(total, currency) },
                      { label: "Balance due", value: rwf(0, currency), strong: true, rule: true },
                    ]
                  : kind === "refund-receipt"
                    ? [
                        { label: "Subtotal", value: rwf(total, currency) },
                        { label: "Total", value: rwf(total, currency), strong: true },
                        { label: "Total Amount Refunded", value: rwf(total, currency) },
                      ]
                    : [{ label: "Total", value: rwf(total, currency), strong: true, big: true }]
            }
          />
        </div>
      </div>
      {isDelayed ? <p className="muted">Delayed {kind === "delayed-credit" ? "credits" : "charges"} don't post to the books — add them to the customer's next invoice.</p> : null}
      <Privacy />

      {recurring ? <RecurringModal kind={kind as TxnKind} defaultName={`${customer?.name ?? cfg.title} recurring`} snapshot={form} onClose={() => setRecurring(false)} /> : null}
      {preview ? (
        <PreviewModal onClose={() => setPreview(false)}>
          <DocPreview
            mode="pdf"
            docTitle={cfg.title}
            number={form.number}
            party={customer?.name ?? ""}
            partyAddress={form.billing}
            dates={[["Date", form.date]]}
            lines={previewLines(form.lines, productOptions)}
            totals={[["Total", rwf(total, currency)]]}
            note={form.message}
          />
        </PreviewModal>
      ) : null}
      {customise ? (
        <Modal title="Customise sales receipt" onClose={() => setCustomise(false)}>
          <label className="txn-check">
            <input type="checkbox" checked={showDate} onChange={(e) => setShowDate(e.target.checked)} /> Show service date column
          </label>
          <button type="button" className="txn-link" onClick={() => navigate("/settings/form-styles")}>
            Edit custom form styles
          </button>
        </Modal>
      ) : null}
    </TxnPage>
  );
}


