import { ChevronDown, ChevronRight, ChevronsUpDown } from "lucide-react";
import { useMemo, useState } from "react";
import { useFeedback } from "../../components/feedback";
import { Select } from "../../components/Select";
import { fmt, num } from "../../components/txn/lines";
import {
  AttachmentBox,
  CancelButton,
  ErrorBanner,
  HeaderBand,
  isBlankRow,
  LineGrid,
  Modal,
  type PickedFile,
  RecurringModal,
  SplitButton,
  TextArea,
  TField,
  TxnFooter,
  TxnPage,
  uploadAttachments,
  useValidation,
  ValidationSummary,
} from "../../components/txn/TxnKit";
import { financialAccountOptions, useFinancialAccounts } from "../../lib/banking";
import { useCompany } from "../../lib/company";
import { amount, isoDay } from "../../lib/format";
import { navigate } from "../../lib/router";
import { useSession } from "../../lib/session";
import {
  BANK_TXN_METHODS,
  indexTxn,
  peekNumber,
  rwf,
  takeNumber,
  useAccountOptions,
  useExpenseAccountOptions,
  useInventoryItems,
  usePayees,
} from "../../lib/txn";
import { yup } from "../../lib/validation";
import { AutofillPanel } from "./SupplierTxnForms";

function Privacy() {
  return (
    <p className="txn-privacy">
      <button type="button" className="txn-link" onClick={() => navigate("/settings/advanced")}>
        Privacy
      </button>
    </p>
  );
}

/* ── Bank deposit (165) ────────────────────────────────── */

type DepositLine = { from: string; account: string; description: string; method: string; ref: string; amount: string };
const emptyDeposit = (): DepositLine => ({ from: "", account: "", description: "", method: "", ref: "", amount: "" });
const DEPOSIT_KEYS = ["from", "account", "description", "method", "ref", "amount"];

export function BankDepositForm() {
  const { api } = useSession();
  const { toast } = useFeedback();
  const { currency } = useCompany();
  const banks = useFinancialAccounts();
  const payees = usePayees();
  const allocation = useAccountOptions();
  const v = useValidation();
  const blank = () => ({ account: "", date: isoDay(), memo: "", trackReturns: false, cashBackTo: "", cashBackMemo: "", cashBack: "", lines: [emptyDeposit(), emptyDeposit()] });
  const [form, setForm] = useState(blank);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recurring, setRecurring] = useState(false);
  const bankOptions = financialAccountOptions(banks.data ?? []);
  const bank = banks.data?.find((b) => b.id === form.account);
  const glOfBanks = new Set((banks.data ?? []).map((b) => b.glAccountId));
  const accountOptions = allocation.filter((o) => !glOfBanks.has(o.value));
  const filled = form.lines.filter((l) => !isBlankRow(l, DEPOSIT_KEYS));
  const fundsTotal = filled.reduce((s, l) => s + num(l.amount), 0);
  const cashBack = num(form.cashBack) || 0;
  const total = fundsTotal - cashBack;

  const schema = yup.object({
    account: yup.string().required("Choose the account you're depositing into"),
    date: yup.string().required("Choose the deposit date"),
    lines: yup
      .array()
      .of(
        yup.object({
          account: yup.string().test("a", "Choose the account this came from", function (val) {
            return isBlankRow(this.parent, DEPOSIT_KEYS) || Boolean(val);
          }),
          ref: yup.string().max(60, "Use 60 characters or fewer"),
          amount: yup.string().test("amt", "Enter an amount more than 0", function (val) {
            return isBlankRow(this.parent, DEPOSIT_KEYS) || num(val ?? "") > 0;
          }),
        }),
      )
      .test("some", "Add at least one line of funds", (rows) => (rows ?? []).some((r) => !isBlankRow(r as DepositLine, DEPOSIT_KEYS))),
    cashBack: yup.string().test("cb", "Cash back can't be more than the funds deposited", (val) => !val || (num(val) >= 0 && num(val) <= fundsTotal)),
    cashBackTo: yup
      .string()
      .test("need", "Choose where the cash back goes", function (val) {
        return !num(this.parent.cashBack ?? "") || Boolean(val);
      })
      .test("diff", "Cash back must go to a different account", function (val) {
        return !val || val !== this.parent.account;
      }),
    memo: yup.string().max(1000, "Use 1,000 characters or fewer"),
  });

  async function save(after: "new" | "close") {
    setError("");
    if (!(await v.validate(schema, form))) return;
    setBusy(true);
    try {
      const firstParty = filled.map((l) => payees.lookup(l.from)).find(Boolean);
      const t = await api<{ id: string; number: string }>("/api/v1/banking/receipts", {
        method: "POST",
        body: JSON.stringify({
          financialAccountId: form.account,
          transactionDate: form.date,
          method: filled.find((l) => l.method)?.method || undefined,
          reference: filled.find((l) => l.ref)?.ref || undefined,
          partyType: firstParty ? firstParty.kind.toUpperCase() : undefined,
          partyName: firstParty?.name,
          description: form.memo.trim() || "Bank deposit",
          lines: filled.map((l) => {
            const from = payees.lookup(l.from)?.name;
            return { accountId: l.account, amount: Math.round(num(l.amount) * 100) / 100, description: [from, l.description.trim(), l.ref && `Ref ${l.ref}`].filter(Boolean).join(" · ").slice(0, 300) || undefined };
          }),
        }),
      });
      if (cashBack > 0) {
        try {
          await api("/api/v1/banking/transfers", {
            method: "POST",
            body: JSON.stringify({ fromAccountId: form.account, toAccountId: form.cashBackTo, transactionDate: form.date, amount: Math.round(cashBack * 100) / 100, description: form.cashBackMemo.trim() || `Cash back from deposit ${t.number}` }),
          });
        } catch (e) {
          throw new Error(`Deposit ${t.number} was saved, but the cash back couldn't be recorded: ${(e as Error).message}. Record it as a transfer.`);
        }
      }
      indexTxn({ id: t.id, kind: "bank-deposit", number: t.number, date: form.date, party: firstParty?.name ?? "", amount: total, memo: form.memo, status: "Posted", posted: true });
      toast(`Deposit ${t.number} of ${rwf(total, currency)} recorded`);
      if (after === "close") return navigate("/banking");
      setForm(blank());
      setFiles([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <TxnPage
      title="Bank Deposit"
      kind="bank-deposit"
      brand={false}
      onClose={() => navigate("/banking")}
      actions={["feedback", "help", "close"]}
      footer={
        <TxnFooter
          left={<CancelButton onClick={() => navigate("/banking")} />}
          center={
            <>
              <button type="button" className="txn-foot-link" onClick={() => window.print()}>
                Print
              </button>
              <button type="button" className="txn-foot-link" onClick={() => setRecurring(true)}>
                Make recurring
              </button>
            </>
          }
          right={<SplitButton label="Save and new" onClick={() => void save("new")} busy={busy} items={[{ label: "Save and close", onSelect: () => void save("close") }]} />}
        />
      }
    >
      <ErrorBanner message={error} onClose={() => setError("")} />
      <ValidationSummary count={v.count} />
      <HeaderBand collapsible={false} amountLabel="AMOUNT" amountValue={rwf(total, currency)}>
        <div className="txn-row" style={{ alignItems: "flex-end" }}>
          <TField label="Account" required error={v.errors.account} className="w-md">
            <Select value={form.account} onChange={(a) => (setForm((f) => ({ ...f, account: a })), v.clear("account"))} options={bankOptions} placeholder="Cash and cash equivalents" invalid={Boolean(v.errors.account)} />
          </TField>
          <span style={{ paddingBottom: 9, fontSize: 16 }}>
            <strong>Balance</strong> {rwf(bank?.balance ?? 0, currency)}
          </span>
          <TField label="Date" required error={v.errors.date} className="w-sm" >
            <input className="txn-input" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          </TField>
        </div>
      </HeaderBand>

      <button type="button" className="txn-collapser" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? <ChevronDown size={24} /> : <ChevronRight size={24} />} Add funds to this deposit
      </button>
      {open ? (
        <>
          <LineGrid
            columns={[
              { key: "from", label: "RECEIVED FROM", kind: "select", options: payees.options, width: "16%" },
              { key: "account", label: "ACCOUNT", kind: "select", options: accountOptions, width: "16%" },
              { key: "description", label: "DESCRIPTION", width: "20%" },
              { key: "method", label: "PAYMENT METHOD", kind: "select", options: BANK_TXN_METHODS, width: "16%" },
              { key: "ref", label: "REF NO.", width: "11%" },
              { key: "amount", label: "AMOUNT", kind: "money", align: "right", width: "13%" },
            ]}
            rows={form.lines}
            onChange={(rows) => (setForm((f) => ({ ...f, lines: rows })), v.clear("lines"))}
            newRow={emptyDeposit}
            errors={v.errors}
            copy={false}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 60, marginTop: -54, marginBottom: 28, fontSize: 18, fontWeight: 750, pointerEvents: "none" }}>
            <span>Other funds total</span>
            <span>{rwf(fundsTotal, currency)}</span>
          </div>
        </>
      ) : null}
      <label className="txn-check" style={{ marginBottom: 22 }}>
        <input type="checkbox" checked={form.trackReturns} onChange={(e) => setForm((f) => ({ ...f, trackReturns: e.target.checked }))} /> Track returns for customers
      </label>
      {form.trackReturns ? <p className="muted" style={{ marginTop: -12 }}>Choose the customer under Received from on each returned line so it shows on their history.</p> : null}

      <div className="txn-lower" style={{ gap: 26 }}>
        <TextArea label="Memo" value={form.memo} onChange={(t) => setForm((f) => ({ ...f, memo: t }))} error={v.errors.memo} className="w-xl" rows={4} />
        <div style={{ flex: 1, display: "grid", gap: 26 }}>
          <div className="txn-row" style={{ flexWrap: "nowrap" }}>
            <TField label="Cash back goes to" error={v.errors.cashBackTo} className="grow">
              <Select value={form.cashBackTo} onChange={(a) => (setForm((f) => ({ ...f, cashBackTo: a })), v.clear("cashBackTo"))} options={bankOptions} placeholder="Cash and cash equivalents" invalid={Boolean(v.errors.cashBackTo)} />
            </TField>
            <TField label="Cash back memo" className="grow">
              <input className="txn-input" value={form.cashBackMemo} maxLength={200} onChange={(e) => setForm((f) => ({ ...f, cashBackMemo: e.target.value }))} />
            </TField>
            <TField label="Cash back amount" error={v.errors.cashBack} className="grow">
              <input className="txn-input num" inputMode="decimal" value={form.cashBack} onChange={(e) => (setForm((f) => ({ ...f, cashBack: e.target.value.replace(/[^\d.,]/g, "") })), v.clear("cashBack"))} onBlur={() => cashBack && setForm((f) => ({ ...f, cashBack: fmt(cashBack) }))} />
            </TField>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 100, fontSize: 24, fontWeight: 800 }}>
            <span>Total</span>
            <span>{rwf(total, currency)}</span>
          </div>
        </div>
      </div>
      <TField label="Attachments" className="w-xl">
        <AttachmentBox files={files} onChange={setFiles} showExisting={false} />
      </TField>
      {files.length ? <p className="muted">Bank transactions don't store files yet — keep deposit slips with your records.</p> : null}
      {recurring ? <RecurringModal kind="bank-deposit" defaultName="Recurring deposit" snapshot={form} onClose={() => setRecurring(false)} /> : null}
    </TxnPage>
  );
}

/* ── Transfer (166) ────────────────────────────────────── */

export function TransferForm() {
  const { api } = useSession();
  const { toast } = useFeedback();
  const { currency } = useCompany();
  const banks = useFinancialAccounts();
  const v = useValidation();
  const blank = () => ({ from: "", to: "", amount: "", date: isoDay(), memo: "" });
  const [form, setForm] = useState(blank);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recurring, setRecurring] = useState(false);
  const options = financialAccountOptions(banks.data ?? []);
  const from = banks.data?.find((b) => b.id === form.from);
  const to = banks.data?.find((b) => b.id === form.to);
  const amt = num(form.amount);
  const set = (k: keyof ReturnType<typeof blank>, val: string) => (setForm((f) => ({ ...f, [k]: val })), v.clear(k));

  const schema = yup.object({
    from: yup.string().required("Choose the account to transfer from"),
    to: yup
      .string()
      .required("Choose the account to transfer to")
      .test("diff", "Choose a different account from the one you're transferring from", function (val) {
        return !val || val !== this.parent.from;
      }),
    amount: yup
      .string()
      .test("amt", "Enter an amount more than 0", (val) => num(val ?? "") > 0)
      .test("bal", `That's more than the account balance and it doesn't allow overdrafts`, (val) => !from || from.allowOverdraft || num(val ?? "") <= from.balance + 0.001),
    date: yup.string().required("Choose the transfer date"),
    memo: yup.string().max(1000, "Use 1,000 characters or fewer"),
  });

  async function save(after: "new" | "close") {
    setError("");
    if (!(await v.validate(schema, form))) return;
    setBusy(true);
    try {
      const t = await api<{ id: string; number: string }>("/api/v1/banking/transfers", {
        method: "POST",
        body: JSON.stringify({ fromAccountId: form.from, toAccountId: form.to, transactionDate: form.date, amount: Math.round(amt * 100) / 100, description: form.memo.trim() || undefined }),
      });
      indexTxn({ id: t.id, kind: "transfer", number: t.number, date: form.date, party: `${from?.name} → ${to?.name}`, amount: amt, memo: form.memo, status: "Posted", posted: true });
      toast(`Transfer ${t.number}: ${rwf(amt, currency)} from ${from?.name} to ${to?.name}`);
      if (after === "close") return navigate("/banking");
      setForm(blank());
      setFiles([]);
      banks.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const balance = (b?: { balance: number }) => (b ? rwf(b.balance, currency) : "");
  return (
    <TxnPage
      title="Transfer"
      kind="transfer"
      brand={false}
      onClose={() => navigate("/banking")}
      actions={["feedback", "help", "close"]}
      footer={
        <TxnFooter
          left={<CancelButton tone="blue" onClick={() => navigate("/banking")} />}
          center={
            <button type="button" className="txn-foot-link" onClick={() => setRecurring(true)}>
              Make recurring
            </button>
          }
          right={<SplitButton label="Save and new" onClick={() => void save("new")} busy={busy} items={[{ label: "Save and close", onSelect: () => void save("close") }]} />}
        />
      }
    >
      <ErrorBanner message={error} onClose={() => setError("")} />
      <HeaderBand collapsible={false}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 480px) 1fr", columnGap: "min(28vw, 430px)", rowGap: 14 }}>
          <TField label="Transfer Funds From" required error={v.errors.from}>
            <Select value={form.from} onChange={(a) => set("from", a)} options={options} placeholder="Transfer Funds From" invalid={Boolean(v.errors.from)} />
          </TField>
          <TField label="Balance">
            <span style={{ fontSize: 16, minHeight: 40, display: "flex", alignItems: "center" }}>{balance(from)}</span>
          </TField>
          <TField label="Transfer Funds To" required error={v.errors.to}>
            <Select value={form.to} onChange={(a) => set("to", a)} options={options} placeholder="Transfer Funds To" invalid={Boolean(v.errors.to)} />
          </TField>
          <TField label="Balance">
            <span style={{ fontSize: 16, minHeight: 40, display: "flex", alignItems: "center" }}>{balance(to)}</span>
          </TField>
          <TField label="Transfer Amount" required error={v.errors.amount} className="w-sm">
            <input className="txn-input num" inputMode="decimal" value={form.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d.,]/g, ""))} onBlur={() => amt && set("amount", fmt(amt))} />
          </TField>
          <TField label="Date" required error={v.errors.date} className="w-sm">
            <input className="txn-input" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
          </TField>
        </div>
      </HeaderBand>
      <div className="txn-lower-left" style={{ width: "min(745px, 100%)" }}>
        <TextArea label="Memo" value={form.memo} onChange={(t) => set("memo", t)} error={v.errors.memo} rows={5} />
        <TField label="Attachments">
          <AttachmentBox files={files} onChange={setFiles} />
        </TField>
      </div>
      <Privacy />
      {recurring ? <RecurringModal kind="transfer" defaultName="Recurring transfer" snapshot={form} onClose={() => setRecurring(false)} /> : null}
    </TxnPage>
  );
}

/* ── Journal entry (167–168) ───────────────────────────── */

type JournalLine = { account: string; debit: string; credit: string; description: string; name: string };
const emptyJournal = (): JournalLine => ({ account: "", debit: "", credit: "", description: "", name: "" });
const JOURNAL_KEYS = ["account", "debit", "credit", "description", "name"];

export function JournalEntryForm() {
  const { api, can } = useSession();
  const { toast, confirm } = useFeedback();
  const { currency, accounts } = useCompany();
  const accountOptions = useAccountOptions();
  const payees = usePayees();
  const v = useValidation();
  const blank = (): { date: string; number: string; memo: string; lines: JournalLine[] } => ({ date: isoDay(), number: peekNumber("journal", 1), memo: "", lines: Array.from({ length: 8 }, emptyJournal) });
  const [form, setForm] = useState(blank);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recurring, setRecurring] = useState(false);
  const [importing, setImporting] = useState(false);
  const filled = form.lines.filter((l) => !isBlankRow(l, JOURNAL_KEYS));
  const debits = filled.reduce((s, l) => s + num(l.debit), 0);
  const credits = filled.reduce((s, l) => s + num(l.credit), 0);
  const balanced = Math.abs(debits - credits) < 0.005;

  const schema = yup.object({
    date: yup.string().required("Choose the journal date"),
    number: yup.string().trim().required("Enter a journal number").max(30, "Use 30 characters or fewer"),
    memo: yup.string().max(1000, "Use 1,000 characters or fewer"),
    lines: yup
      .array()
      .of(
        yup.object({
          account: yup.string().test("a", "Choose an account", function (val) {
            return isBlankRow(this.parent, JOURNAL_KEYS) || Boolean(val);
          }),
          debit: yup.string().test("one", "Enter a debit or a credit, not both", function (val) {
            if (isBlankRow(this.parent, JOURNAL_KEYS)) return true;
            const d = num(val ?? "");
            const c = num(this.parent.credit ?? "");
            return (d > 0) !== (c > 0) && d >= 0 && c >= 0;
          }),
          credit: yup.string().test("neg", "Amounts can't be negative", (val) => !val || num(val) >= 0),
          description: yup.string().max(300, "Use 300 characters or fewer"),
        }),
      )
      .test("two", "A journal needs at least two lines", (rows) => (rows ?? []).filter((r) => !isBlankRow(r as JournalLine, JOURNAL_KEYS)).length >= 2)
      .test("balanced", "Debits and credits must be equal", () => balanced),
  });

  async function save(mode: "draft" | "new" | "close" | "post" | "submit") {
    setError("");
    if (!(await v.validate(schema, form))) return;
    setBusy(true);
    try {
      const j = await api<{ id: string; journalNumber?: string; status?: string }>("/api/v1/journals", {
        method: "POST",
        body: JSON.stringify({
          journalDate: form.date,
          referenceNumber: form.number.trim(),
          description: form.memo.trim() || `Journal entry ${form.number}`,
          postImmediately: mode === "post" || undefined,
          submit: mode === "submit" || undefined,
          lines: filled.map((l) => {
            const name = payees.lookup(l.name)?.name;
            return { accountId: l.account, debit: Math.round(num(l.debit) * 100) / 100, credit: Math.round(num(l.credit) * 100) / 100, description: [l.description.trim(), name].filter(Boolean).join(" — ") || undefined };
          }),
        }),
      });
      takeNumber("journal", form.number, 1);
      if (files.length) {
        const failed = await uploadAttachments(api, "Journal", j.id, files);
        if (failed) toast(`${failed} attachment${failed > 1 ? "s" : ""} couldn't be uploaded`, { error: true });
      }
      const status = mode === "post" ? "Posted" : mode === "submit" ? "Submitted" : "Draft";
      indexTxn({ id: j.id, kind: "journal", number: j.journalNumber ?? form.number, date: form.date, party: "", amount: debits, memo: form.memo, status, posted: mode === "post" });
      toast(`Journal entry #${form.number} ${mode === "post" ? "posted" : mode === "submit" ? "submitted for approval" : "saved as a draft"}`);
      if (mode === "close" || mode === "post" || mode === "submit") return navigate("/journals");
      setForm(blank());
      setFiles([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function copyEntry() {
    setForm((f) => ({ ...f, number: peekNumber("journal", 1) === f.number ? String(Number(f.number) + 1) : peekNumber("journal", 1), date: isoDay() }));
    toast("Copied — change what you need and save it as a new entry");
  }

  async function clearForm() {
    if (await confirm({ title: "Clear this journal entry?", body: "Every line and the memo will be emptied.", confirmLabel: "Clear", danger: true })) {
      setForm(blank());
      setFiles([]);
      v.setErrors({});
    }
  }

  function importRows(rows: string[][]) {
    const byKey = (key: string) => accounts.find((a) => a.code === key.trim() || a.name.toLowerCase() === key.trim().toLowerCase());
    const unknown: string[] = [];
    const lines = rows.map(([acc = "", debit = "", credit = "", description = "", name = ""]) => {
      const a = byKey(acc);
      if (!a) unknown.push(acc);
      const payee = payees.options.find((o) => o.label.toLowerCase() === name.trim().toLowerCase());
      return { account: a?.id ?? "", debit: num(debit) ? fmt(num(debit)) : "", credit: num(credit) ? fmt(num(credit)) : "", description, name: payee?.value ?? "" };
    });
    setForm((f) => ({ ...f, lines: [...lines, ...Array.from({ length: Math.max(0, 8 - lines.length) }, emptyJournal)] }));
    setImporting(false);
    toast(unknown.length ? `${lines.length} lines imported — ${unknown.length} account${unknown.length > 1 ? "s" : ""} not found: ${unknown.slice(0, 3).join(", ")}` : `${lines.length} lines imported`, { error: unknown.length > 0 });
  }

  const saveItems = [
    { label: "Save and close", onSelect: () => void save("close") },
    ...(can("journal:post") ? [{ label: "Save and post", onSelect: () => void save("post") }] : []),
    { label: "Save and submit for approval", onSelect: () => void save("submit") },
  ];

  return (
    <TxnPage
      title={`Journal Entry #${form.number}`}
      kind="journal"
      brand={false}
      onClose={() => navigate("/journals")}
      actions={["copy", "feedback", "settings", "help", "close"]}
      onCopy={copyEntry}
      onSettings={() => navigate("/settings/advanced")}
      footer={
        <TxnFooter
          left={
            <>
              <CancelButton tone="blue" onClick={() => navigate("/journals")} />
              <button type="button" className="txn-btn-outline blue" onClick={() => void clearForm()}>
                Clear
              </button>
            </>
          }
          center={
            <button type="button" className="txn-foot-link" onClick={() => setRecurring(true)}>
              Make recurring
            </button>
          }
          right={
            <>
              <button type="button" className="txn-btn-outline blue" onClick={() => void save("draft")} disabled={busy}>
                Save
              </button>
              <SplitButton label="Save and new" onClick={() => void save("new")} busy={busy} items={saveItems} />
            </>
          }
        />
      }
    >
      <ErrorBanner message={error} onClose={() => setError("")} />
      <ValidationSummary count={v.count} />
      <HeaderBand collapsible={false} aside={<button type="button" className="txn-btn-outline blue" style={{ fontWeight: 500 }} onClick={() => setImporting(true)}>Import</button>}>
        <div className="txn-row">
          <TField label="Journal date" required error={v.errors.date} className="w-sm">
            <input className="txn-input" type="date" value={form.date} onChange={(e) => (setForm((f) => ({ ...f, date: e.target.value })), v.clear("date"))} />
          </TField>
          <TField label="Journal no." required error={v.errors.number} className="txn-w-800">
            <input className="txn-input" value={form.number} onChange={(e) => (setForm((f) => ({ ...f, number: e.target.value })), v.clear("number"))} />
          </TField>
        </div>
      </HeaderBand>
      <LineGrid
        columns={[
          { key: "account", label: "ACCOUNT", kind: "select", options: accountOptions, width: "20%" },
          { key: "debit", label: "DEBITS", kind: "money", align: "right", width: "13%", onSet: (r, val) => ({ ...r, debit: val, credit: num(val) > 0 ? "" : r.credit }) },
          { key: "credit", label: "CREDITS", kind: "money", align: "right", width: "13%", onSet: (r, val) => ({ ...r, credit: val, debit: num(val) > 0 ? "" : r.debit }) },
          { key: "description", label: "DESCRIPTION", width: "24%" },
          { key: "name", label: "NAME", kind: "select", options: payees.options, width: "20%" },
        ]}
        rows={form.lines}
        onChange={(rows) => (setForm((f) => ({ ...f, lines: rows })), v.clear("lines"))}
        newRow={emptyJournal}
        errors={v.errors}
        footerRow={
          <tr>
            <td colSpan={3} className="right" style={{ fontSize: 18 }}>
              Total
            </td>
            <td className="right" style={{ color: balanced ? undefined : "#b42318" }}>{rwf(debits, currency)}</td>
            <td className="right" style={{ color: balanced ? undefined : "#b42318" }}>{rwf(credits, currency)}</td>
            <td colSpan={4}>{!balanced ? <span className="field-error">Out of balance by {amount(Math.abs(debits - credits), 2)}</span> : null}</td>
          </tr>
        }
      />
      <div className="txn-lower" style={{ gap: 40 }}>
        <TextArea label="Memo" value={form.memo} onChange={(t) => setForm((f) => ({ ...f, memo: t }))} error={v.errors.memo} className="w-xl" />
        <TField label="Attachments" className="w-xl">
          <AttachmentBox files={files} onChange={setFiles} showExisting={false} />
        </TField>
      </div>
      {recurring ? <RecurringModal kind="journal" defaultName={`Journal ${form.number} recurring`} snapshot={form} onClose={() => setRecurring(false)} /> : null}
      {importing ? <JournalImportModal onClose={() => setImporting(false)} onRows={importRows} /> : null}
    </TxnPage>
  );
}

function JournalImportModal({ onClose, onRows }: { onClose: () => void; onRows: (rows: string[][]) => void }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  function parse(raw: string) {
    return raw
      .split(/\r?\n/)
      .map((l) => l.split(/[,\t;]/).map((c) => c.replace(/^"|"$/g, "").trim()))
      .filter((r) => r.some(Boolean) && !/^account/i.test(r[0] ?? ""));
  }
  return (
    <Modal
      title="Import journal lines"
      onClose={onClose}
      width={640}
      footer={
        <>
          <button type="button" className="txn-btn-outline blue" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="txn-btn-primary"
            onClick={() => {
              const rows = parse(text);
              if (rows.length < 2) return setError("Paste at least two lines: account, debit, credit, description, name");
              onRows(rows);
            }}
          >
            Import
          </button>
        </>
      }
    >
      <p className="muted" style={{ margin: 0 }}>
        One line per row: <strong>account code or name, debit, credit, description, name</strong>. Paste from a spreadsheet or choose a CSV file.
      </p>
      <input
        type="file"
        accept=".csv,.txt"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (f) setText(await f.text());
        }}
      />
      <TextArea label="Lines" value={text} onChange={(t) => (setText(t), setError(""))} rows={8} maxLength={20000} error={error || undefined} placeholder={"4000, , 150000, Consulting income\n1100, 150000, , Bank deposit"} />
    </Modal>
  );
}

/* ── Inventory adjustment (169–170) ────────────────────── */

type AdjLine = { item: string; sku: string; description: string; onHand: string; newQty: string; change: string };
const emptyAdj = (): AdjLine => ({ item: "", sku: "", description: "", onHand: "", newQty: "", change: "" });
const ADJ_KEYS = ["item", "description", "newQty", "change"];
const REASONS = ["Shrinkage", "Damaged goods", "Theft", "Stock count correction", "Expired stock", "Received without bill", "Other"];

export function InventoryAdjustmentForm() {
  const { toast } = useFeedback();
  const { api } = useSession();
  const { accounts } = useCompany();
  const items = useInventoryItems();
  const expense = useExpenseAccountOptions();
  const v = useValidation();
  const shrinkage = accounts.find((a) => /shrink/i.test(a.name))?.id ?? "";
  const blank = () => ({ type: "QUANTITY", date: isoDay(), reference: peekNumber("inventory-adjustment", 1), reason: "Shrinkage", account: shrinkage, memo: "", lines: [emptyAdj(), emptyAdj()] });
  const [form, setForm] = useState(blank);
  const [autofill, setAutofill] = useState(true);
  const isValue = form.type === "VALUE";
  const itemOptions = useMemo(() => items.map((i) => ({ value: i.id, label: i.name, hint: i.sku || undefined })), [items]);
  const onHandOf = (id: string) => {
    const i = items.find((x) => x.id === id);
    return i ? (isValue ? i.quantity * i.unitCost : i.quantity) : 0;
  };

  const schema = yup.object({
    type: yup.string().oneOf(["QUANTITY", "VALUE"]),
    date: yup.string().required("Choose the adjustment date"),
    reference: yup.string().trim().required("Enter a reference number").max(21, "Use 21 characters or fewer"),
    reason: yup.string().required("Choose a reason"),
    account: yup.string().required("Choose the inventory adjustment account"),
    memo: yup.string().max(1000, "Use 1,000 characters or fewer"),
    lines: yup
      .array()
      .of(
        yup.object({
          item: yup.string().test("i", "Choose an item", function (val) {
            return isBlankRow(this.parent, ADJ_KEYS) || Boolean(val);
          }),
          newQty: yup.string().test("q", isValue ? "New value can't be negative" : "New quantity can't be negative", function (val) {
            return isBlankRow(this.parent, ADJ_KEYS) || (val !== undefined && val !== "" && num(val) >= 0);
          }),
          change: yup.string().test("c", "The change can't be zero", function (val) {
            return isBlankRow(this.parent, ADJ_KEYS) || Math.abs(num(val ?? "")) > 0;
          }),
        }),
      )
      .test("some", "Add at least one item to adjust", (rows) => (rows ?? []).some((r) => !isBlankRow(r as AdjLine, ADJ_KEYS))),
  });

  function save(close: boolean) {
    void v.validate(schema, form).then(async (ok) => {
      if (!ok) return;
      const lines = form.lines.filter((l) => !isBlankRow(l, ADJ_KEYS));
      let saved: { id: string; status: string; value: string | number };
      try {
        saved = await api("/api/v1/inventory/adjustments", {
          method: "POST",
          body: JSON.stringify({ number: form.reference, type: form.type, date: form.date, reason: form.reason, accountId: form.account, memo: form.memo, lines: lines.map((l) => ({ itemId: l.item, change: num(l.change) })) }),
        });
      } catch (e) {
        toast((e as Error).message, { error: true });
        return;
      }
      const id = saved.id;
      const value = Number(saved.value);
      const waiting = saved.status === "PENDING_APPROVAL";
      takeNumber("inventory-adjustment", form.reference, 1);
      indexTxn({ id, kind: "inventory-adjustment", number: form.reference, date: form.date, party: form.reason, amount: Math.abs(value), memo: form.memo, status: waiting ? "Pending approval" : "Posted", posted: false });
      toast(waiting ? `Inventory adjustment #${form.reference} sent for approval; stock changes once it's approved` : `Inventory adjustment #${form.reference} posted for ${lines.length} item${lines.length > 1 ? "s" : ""}`);
      if (close) return navigate("/inventory/movements");
      setForm(blank());
    });
  }

  const setLines = (rows: AdjLine[]) => (setForm((f) => ({ ...f, lines: rows })), v.clear("lines"));
  return (
    <TxnPage
      title={`Inventory adjustment #${form.reference}`}
      kind="inventory-adjustment"
      brand={false}
      onClose={() => navigate("/inventory")}
      actions={["feedback", "help", "autofill", "close"]}
      feedbackLabel="Give Feedback"
      autofillOn={autofill}
      onAutofill={() => setAutofill((a) => !a)}
      left={
        autofill ? (
          <InventoryAutofill
            onClose={() => setAutofill(false)}
            onRows={(rows) =>
              setLines([
                ...form.lines.filter((l) => !isBlankRow(l, ADJ_KEYS)),
                ...rows.map(([name = "", newQty = ""]) => {
                  const item = items.find((i) => i.name.toLowerCase() === name.toLowerCase() || i.sku.toLowerCase() === name.toLowerCase());
                  const onHand = item ? onHandOf(item.id) : 0;
                  return { item: item?.id ?? "", sku: item?.sku ?? "", description: item?.name ?? name, onHand: String(onHand), newQty, change: String(num(newQty) - onHand) };
                }),
              ])
            }
          />
        ) : undefined
      }
      footer={
        <TxnFooter
          left={<CancelButton tone="blue" onClick={() => navigate("/inventory")} />}
          right={
            <>
              <button type="button" className="txn-btn-outline blue" onClick={() => save(false)}>
                Save
              </button>
              <SplitButton label="Save and close" onClick={() => save(true)} items={[{ label: "Save and new", onSelect: () => save(false) }]} />
            </>
          }
        />
      }
    >
      <ValidationSummary count={v.count} />
      <HeaderBand collapsible={false}>
        <div className="txn-row">
          <TField label="Adjustment type" className="w-md">
            <Select value={form.type} onChange={(t) => setForm((f) => ({ ...f, type: t, lines: [emptyAdj(), emptyAdj()] }))} searchable={false} options={[{ value: "QUANTITY", label: "Quantity" }, { value: "VALUE", label: "Value" }]} />
          </TField>
          <TField label="Adjustment date" required error={v.errors.date} className="w-md">
            <input className="txn-input" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          </TField>
          <TField label="Reference number" required error={v.errors.reference} className="w-md">
            <input className="txn-input" value={form.reference} onChange={(e) => (setForm((f) => ({ ...f, reference: e.target.value })), v.clear("reference"))} />
          </TField>
        </div>
        <div className="txn-row">
          <TField label="Adjustment reason" required error={v.errors.reason} className="w-md">
            <Select value={form.reason} onChange={(r) => setForm((f) => ({ ...f, reason: r }))} searchable={false} options={REASONS.map((r) => ({ value: r, label: r }))} />
          </TField>
          <TField label="Inventory adjustment account" required error={v.errors.account} className="w-md">
            <Select value={form.account} onChange={(a) => (setForm((f) => ({ ...f, account: a })), v.clear("account"))} options={expense} placeholder="Inventory Shrinkage" invalid={Boolean(v.errors.account)} />
          </TField>
        </div>
      </HeaderBand>
      <h3 style={{ fontSize: 24, margin: "0 0 4px" }}>Item details</h3>
      <LineGrid
        columns={[
          {
            key: "item",
            label: "ITEM",
            kind: "select",
            options: itemOptions,
            width: "18%",
            onSet: (r, val) => {
              const item = items.find((i) => i.id === val);
              const onHand = onHandOf(val);
              return { ...r, item: val, sku: item?.sku ?? "", description: r.description || item?.name || "", onHand: String(Math.round(onHand * 100) / 100), newQty: r.newQty, change: r.newQty ? String(num(r.newQty) - onHand) : r.change };
            },
          },
          { key: "sku", label: "SKU", kind: "readonly", width: "10%" },
          { key: "description", label: "DESCRIPTION", width: "16%" },
          {
            key: "onHand",
            label: isValue ? "VALUE ON HAND" : "QTY ON HAND",
            width: "12%",
            render: (r) => (
              <span className="txn-cell-static" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                {r.item ? amount(num(r.onHand), isValue ? 2 : 0) : ""}
                <ChevronsUpDown size={16} className="muted" />
              </span>
            ),
          },
          { key: "newQty", label: isValue ? "NEW VALUE" : "NEW QTY", kind: "number", width: "11%", onSet: (r, val) => ({ ...r, newQty: val, change: val === "" ? "" : String(Math.round((num(val) - num(r.onHand)) * 100) / 100) }) },
          { key: "change", label: isValue ? "CHANGE IN VALUE" : "CHANGE IN QTY", kind: "number", width: "12%", onSet: (r, val) => ({ ...r, change: val, newQty: val === "" || val === "-" ? r.newQty : String(Math.round((num(r.onHand) + num(val)) * 100) / 100) }) },
        ]}
        rows={form.lines}
        onChange={setLines}
        newRow={emptyAdj}
        errors={v.errors}
        copy={false}
      />
      {itemOptions.length === 0 ? <p className="muted" style={{ marginTop: -10 }}>No stocked items yet — add products under Inventory first.</p> : null}
      <TextArea label="Memo" value={form.memo} onChange={(t) => setForm((f) => ({ ...f, memo: t }))} error={v.errors.memo} className="w-lg" rows={4} />
      <p className="muted">Adjustments update stock and post to the books when saved, or once approved if your company requires approval.</p>
      <Privacy />
    </TxnPage>
  );
}

function InventoryAutofill({ onClose, onRows }: { onClose: () => void; onRows: (rows: string[][]) => void }) {
  const { toast } = useFeedback();
  return (
    <AutofillPanel
      title="Autofill this Inventory adjustment"
      photos={false}
      showSample={false}
      formats="PDF, PNG, JPEG."
      accept=".pdf,.png,.jpg,.jpeg,.csv"
      onClose={onClose}
      onFiles={(fs) => toast(`${fs.length} document${fs.length > 1 ? "s" : ""} kept for reference — enter the counts from it`)}
      onRows={onRows}
    />
  );
}

/* ── Pay down credit card (171) ────────────────────────── */

export function PayDownCreditCardForm() {
  const { api } = useSession();
  const { toast } = useFeedback();
  const { currency, accounts } = useCompany();
  const banks = useFinancialAccounts();
  const payees = usePayees();
  const v = useValidation();
  const cards = useMemo(
    () =>
      accounts
        .filter((a) => a.isActive && a.type === "LIABILITY" && a.allowManualPost)
        .sort((a, b) => Number(/card/i.test(b.name)) - Number(/card/i.test(a.name)))
        .map((a) => ({ value: a.id, label: a.name, prefix: a.code, group: /card/i.test(a.name) ? "Credit cards" : "Other liabilities" })),
    [accounts],
  );
  const blank = () => ({ card: "", payee: "", amount: "", date: isoDay(), bank: "", memo: "" });
  const [form, setForm] = useState(blank);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [memoOpen, setMemoOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const amt = num(form.amount);
  const bank = banks.data?.find((b) => b.id === form.bank);
  const set = (k: keyof ReturnType<typeof blank>, val: string) => (setForm((f) => ({ ...f, [k]: val })), v.clear(k));

  const schema = yup.object({
    card: yup.string().required("Choose the credit card you paid"),
    amount: yup
      .string()
      .test("amt", "Enter an amount more than 0", (val) => num(val ?? "") > 0)
      .test("bal", "That's more than the bank balance and it doesn't allow overdrafts", (val) => !bank || bank.allowOverdraft || num(val ?? "") <= bank.balance + 0.001),
    date: yup.string().required("Choose the date of payment"),
    bank: yup.string().required("Choose the account you paid from"),
    memo: yup.string().max(1000, "Use 1,000 characters or fewer"),
  });

  async function save(after: "stay" | "new" | "close") {
    setError("");
    if (!(await v.validate(schema, form))) return;
    setBusy(true);
    try {
      const card = cards.find((c) => c.value === form.card);
      const payee = payees.lookup(form.payee);
      const t = await api<{ id: string; number: string }>("/api/v1/banking/payments", {
        method: "POST",
        body: JSON.stringify({
          financialAccountId: form.bank,
          transactionDate: form.date,
          partyType: payee ? payee.kind.toUpperCase() : undefined,
          partyName: payee?.name,
          description: form.memo.trim() || `Credit card payment — ${card?.label}`,
          lines: [{ accountId: form.card, amount: Math.round(amt * 100) / 100, description: `Payment to ${card?.label}`.slice(0, 300) }],
        }),
      });
      indexTxn({ id: t.id, kind: "credit-card-payment", number: t.number, date: form.date, party: payee?.name ?? card?.label ?? "", amount: amt, memo: form.memo, status: "Posted", posted: true });
      toast(`Paid ${rwf(amt, currency)} towards ${card?.label}`);
      if (after === "close") return navigate("/banking");
      setForm(blank());
      setFiles([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <TxnPage
      title="Pay down credit card"
      kind="credit-card-payment"
      brand={false}
      onClose={() => navigate("/banking")}
      actions={["feedback", "help", "close"]}
      footer={
        <TxnFooter
          left={
            <>
              <CancelButton tone="blue" onClick={() => navigate("/banking")} />
              <button type="button" className="txn-btn-outline blue" onClick={() => (setForm(blank()), v.setErrors({}))}>
                Clear
              </button>
            </>
          }
          right={
            <>
              <button type="button" className="txn-btn-outline blue" onClick={() => void save("stay")} disabled={busy}>
                Save
              </button>
              <SplitButton label="Save and close" onClick={() => void save("close")} busy={busy} items={[{ label: "Save and new", onSelect: () => void save("new") }]} />
            </>
          }
        />
      }
    >
      <ErrorBanner message={error} onClose={() => setError("")} />
      <ValidationSummary count={v.count} />
      <div style={{ display: "flex", gap: 40, alignItems: "flex-start", paddingTop: 20 }}>
        <div style={{ width: "min(890px, 100%)", display: "grid", gap: 16 }}>
          <h2 style={{ margin: 0, fontSize: 21 }}>Record payments made to your balance</h2>
          <TField label="Which credit card did you pay?" required error={v.errors.card}>
            <Select value={form.card} onChange={(c) => set("card", c)} options={cards} placeholder="Select credit card" invalid={Boolean(v.errors.card)} emptyText="No liability accounts — add a credit card account in the chart of accounts" />
          </TField>
          <TField label="Payee (optional)">
            <Select value={form.payee} onChange={(p) => set("payee", p)} options={[{ value: "", label: "No payee" }, ...payees.options]} placeholder="Choose a payee" />
          </TField>
          <div className="txn-form-grid">
            <TField label="How much did you pay?" required error={v.errors.amount}>
              <input className="txn-input" inputMode="decimal" placeholder="Enter the amount" value={form.amount} onChange={(e) => set("amount", e.target.value.replace(/[^\d.,]/g, ""))} onBlur={() => amt && set("amount", fmt(amt))} />
            </TField>
            <TField label="Date of payment" required error={v.errors.date}>
              <input className="txn-input" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
            </TField>
          </div>
          <TField label="What did you use to make this payment?" required error={v.errors.bank}>
            <Select value={form.bank} onChange={(b) => set("bank", b)} options={financialAccountOptions(banks.data ?? [])} placeholder="Select bank account" invalid={Boolean(v.errors.bank)} />
          </TField>
          <button type="button" className="txn-collapser" onClick={() => setMemoOpen((o) => !o)} aria-expanded={memoOpen} style={{ marginTop: 16 }}>
            {memoOpen ? <ChevronDown size={24} /> : <ChevronRight size={24} />} Memo and attachments
          </button>
          {memoOpen ? (
            <>
              <TextArea label="Memo" value={form.memo} onChange={(t) => set("memo", t)} error={v.errors.memo} />
              <TField label="Attachments">
                <AttachmentBox files={files} onChange={setFiles} showExisting={false} />
              </TField>
            </>
          ) : null}
          <Privacy />
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right", paddingTop: 30 }}>
          <div style={{ fontSize: 20, fontWeight: 750 }}>Total paid</div>
          <div className="txn-amount">{rwf(amt, currency)}</div>
        </div>
      </div>
    </TxnPage>
  );
}
