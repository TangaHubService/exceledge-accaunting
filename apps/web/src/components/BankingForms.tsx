import { transferTypeFor } from "@exceledge/accounting-domain";
import { Plus, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { accountOptions } from "../pages/Accounts";
import {
  ACCOUNT_KIND_LABELS,
  BANK_METHODS,
  financialAccountOptions,
  hasStatement,
  isCash,
  LINE_KIND_LABELS,
  TRANSFER_LABELS,
  txnLabel,
  useFinancialAccounts,
} from "../lib/banking";
import { useCompany } from "../lib/company";
import { amount, date, dateTime, isoDay, money } from "../lib/format";
import { Link, navigate } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { BankTransaction, FinancialAccount, FinancialAccountKind, Reconciliation, StatementLine, StatementLineKind, StatementPreview } from "../lib/types";
import { useFeedback } from "./feedback";
import { Footer, FormError, MoneyInput, parseAmount, SummaryRows, useSubmit } from "./forms";
import { Select, type SelectOption } from "./Select";
import { Badge, Drawer, Field } from "./ui";

/** Active GL accounts for allocation, leaving out the ledgers behind bank and cash accounts (use a transfer for those). */
function useAllocationOptions(accounts: FinancialAccount[]): SelectOption[] {
  const { accounts: gl } = useCompany();
  return useMemo(() => {
    const linked = new Set(accounts.map((a) => a.glAccountId));
    return accountOptions(gl.filter((a) => a.isActive && !linked.has(a.id)));
  }, [gl, accounts]);
}

/* ── Bank or cash account ──────────────────────────────── */

export function FinancialAccountForm({ account, onClose, onSaved }: { account?: FinancialAccount; onClose: () => void; onSaved: (a: FinancialAccount) => void }) {
  const { api } = useSession();
  const { accounts: gl, currency } = useCompany();
  const linked = useFinancialAccounts(true);
  const editing = Boolean(account);
  const [form, setForm] = useState({
    kind: (account?.kind ?? "BANK") as FinancialAccountKind,
    name: account?.name ?? "",
    bankName: account?.bankName ?? "",
    branchName: account?.branchName ?? "",
    accountNumber: account?.accountNumber ?? "",
    swiftCode: account?.swiftCode ?? "",
    provider: account?.provider ?? "",
    custodian: account?.custodian ?? "",
    glMode: "new" as "new" | "existing",
    glAccountId: "",
    openingBalance: "",
    dateOpened: isoDay(),
    reconcileFrom: account ? account.reconcileFrom.slice(0, 10) : "",
    allowOverdraft: account?.allowOverdraft ?? true,
    notes: account?.notes ?? "",
    isActive: account?.isActive ?? true,
  });
  const [overdraftTouched, setOverdraftTouched] = useState(editing);
  const { busy, error, run } = useSubmit();
  const set = <K extends keyof typeof form>(k: K) => (v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const kind = form.kind;
  const overdraft = overdraftTouched ? form.allowOverdraft : kind === "BANK";
  const swiftInvalid = form.swiftCode !== "" && !/^[A-Za-z0-9]{8}([A-Za-z0-9]{3})?$/.test(form.swiftCode);
  const glChoices = useMemo(() => {
    const taken = new Set((linked.data ?? []).map((a) => a.glAccountId));
    return accountOptions(gl.filter((a) => a.isActive && a.type === "ASSET" && !taken.has(a.id)));
  }, [gl, linked.data]);
  const chosenGl = gl.find((a) => a.id === form.glAccountId);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (swiftInvalid) return;
    const opening = parseAmount(form.openingBalance);
    const details = {
      name: form.name.trim(),
      accountNumber: form.accountNumber.trim() || undefined,
      bankName: kind === "BANK" ? form.bankName.trim() || undefined : undefined,
      branchName: kind === "BANK" ? form.branchName.trim() || undefined : undefined,
      swiftCode: kind === "BANK" ? form.swiftCode.trim().toUpperCase() || undefined : undefined,
      provider: kind === "MOBILE_MONEY" ? form.provider.trim() || undefined : undefined,
      custodian: isCash(kind) ? form.custodian.trim() || undefined : undefined,
      allowOverdraft: overdraft,
      notes: form.notes.trim() || undefined,
      reconcileFrom: form.reconcileFrom || undefined,
    };
    void run(async () => {
      const saved = editing
        ? await api<FinancialAccount>(`/api/v1/banking/accounts/${account!.id}`, { method: "PATCH", body: JSON.stringify({ ...details, isActive: form.isActive }) })
        : await api<FinancialAccount>("/api/v1/banking/accounts", {
            method: "POST",
            body: JSON.stringify({
              ...details,
              kind,
              currency,
              glAccountId: form.glMode === "existing" ? form.glAccountId || undefined : undefined,
              openingBalance: Number.isFinite(opening) && opening !== 0 ? opening : undefined,
              dateOpened: form.dateOpened,
            }),
          });
      onSaved(saved);
      return editing ? `${saved.name} updated` : `${saved.name} added on ${saved.glAccountCode} ${saved.glAccountName}`;
    });
  }

  return (
    <Drawer
      title={editing ? `Edit ${account!.name}` : "Add bank or cash account"}
      subtitle={editing ? `${ACCOUNT_KIND_LABELS[account!.kind]} · ${account!.glAccountCode} ${account!.glAccountName}` : "Each account keeps its own ledger account, cashbook and reconciliation."}
      onClose={onClose}
      footer={<Footer onCancel={onClose} busy={busy} label={editing ? "Save changes" : "Add account"} formId="fa-form" />}
    >
      <form id="fa-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="form-grid">
          {!editing && (
            <Field label="Type" required className="span-2">
              <div className="segmented" role="group" aria-label="Account type">
                {(["BANK", "MOBILE_MONEY", "CASH", "PETTY_CASH"] as FinancialAccountKind[]).map((k) => (
                  <button key={k} type="button" className={kind === k ? "on" : ""} onClick={() => set("kind")(k)}>
                    {ACCOUNT_KIND_LABELS[k]}
                  </button>
                ))}
              </div>
            </Field>
          )}
          <Field label="Account name" required className="span-2" hint="How it appears in lists and on reports, e.g. BK Main or Head office till">
            <input className="input" value={form.name} onChange={(e) => set("name")(e.target.value)} required maxLength={120} />
          </Field>
          {kind === "BANK" && (
            <>
              <Field label="Bank">
                <input className="input" value={form.bankName} onChange={(e) => set("bankName")(e.target.value)} placeholder="e.g. Bank of Kigali" />
              </Field>
              <Field label="Branch">
                <input className="input" value={form.branchName} onChange={(e) => set("branchName")(e.target.value)} />
              </Field>
              <Field label="Account number">
                <input className="input" value={form.accountNumber} onChange={(e) => set("accountNumber")(e.target.value)} />
              </Field>
              <Field label="SWIFT code" error={swiftInvalid ? "8 or 11 letters and digits" : null}>
                <input className={`input ${swiftInvalid ? "invalid" : ""}`} value={form.swiftCode} onChange={(e) => set("swiftCode")(e.target.value.replace(/\s/g, ""))} maxLength={11} />
              </Field>
            </>
          )}
          {kind === "MOBILE_MONEY" && (
            <>
              <Field label="Provider">
                <input className="input" value={form.provider} onChange={(e) => set("provider")(e.target.value)} placeholder="e.g. MTN MoMo, Airtel Money" />
              </Field>
              <Field label="Wallet or merchant number">
                <input className="input" value={form.accountNumber} onChange={(e) => set("accountNumber")(e.target.value)} />
              </Field>
            </>
          )}
          {isCash(kind) && (
            <Field label="Custodian" className="span-2" hint="The person responsible for the cash">
              <input className="input" value={form.custodian} onChange={(e) => set("custodian")(e.target.value)} />
            </Field>
          )}
        </div>

        {!editing && (
          <>
            <div className="form-section-title" style={{ marginTop: 22 }}>Ledger account</div>
            <div className="form-grid">
              <Field label="Post to" className="span-2">
                <Select
                  value={form.glMode}
                  onChange={(v) => set("glMode")(v as "new" | "existing")}
                  searchable={false}
                  options={[
                    { value: "new", label: "Create a new ledger account for it" },
                    { value: "existing", label: "Use an existing asset account" },
                  ]}
                />
              </Field>
              {form.glMode === "existing" && (
                <Field label="Existing account" required className="span-2" hint="Asset accounts not already used by another bank or cash account">
                  <Select value={form.glAccountId} onChange={set("glAccountId")} options={glChoices} placeholder="Select an account…" searchable required emptyText="Every asset account is already linked" />
                </Field>
              )}
              <Field
                label={`Opening balance (${currency})`}
                hint={
                  form.glMode === "existing" && chosenGl?.hasPostedTransactions
                    ? "This account already has postings, so its balance carries over. Leave this empty."
                    : "Balance on the day you start using Accounting. Posted against the suspense account."
                }
              >
                <MoneyInput value={form.openingBalance} onChange={set("openingBalance")} placeholder="0" disabled={form.glMode === "existing" && chosenGl?.hasPostedTransactions} />
              </Field>
              <Field label="Opening date" required>
                <input className="input" type="date" value={form.dateOpened} onChange={(e) => set("dateOpened")(e.target.value)} required />
              </Field>
            </div>
          </>
        )}

        <div className="form-section-title" style={{ marginTop: 22 }}>Controls</div>
        <div className="form-grid">
          {hasStatement(kind) && (
            <Field
              label="Reconcile from"
              className="span-2"
              hint={editing && account!.lastReconciledTo ? "Fixed once a reconciliation is completed" : "Entries before this date are treated as already cleared. Defaults to the opening date."}
            >
              <input
                className="input"
                type="date"
                value={form.reconcileFrom}
                onChange={(e) => set("reconcileFrom")(e.target.value)}
                disabled={editing && Boolean(account!.lastReconciledTo)}
              />
            </Field>
          )}
          <label className="check span-2">
            <input
              type="checkbox"
              checked={overdraft}
              onChange={(e) => {
                setOverdraftTouched(true);
                set("allowOverdraft")(e.target.checked);
              }}
            />
            Allow payments that take the balance below zero
          </label>
          {editing && (
            <label className="check span-2">
              <input type="checkbox" checked={form.isActive} onChange={(e) => set("isActive")(e.target.checked)} />
              Active — inactive accounts keep their history but can't be used for new transactions
            </label>
          )}
          <Field label="Notes" className="span-2">
            <textarea className="input" value={form.notes} onChange={(e) => set("notes")(e.target.value)} />
          </Field>
        </div>
      </form>
    </Drawer>
  );
}

/* ── Money received / paid ─────────────────────────────── */

type Line = { accountId: string; amount: string; description: string };

export function MoneyForm({
  direction,
  accountId: presetAccount,
  onClose,
  onSaved,
}: {
  direction: "in" | "out";
  accountId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { api } = useSession();
  const { currency, snapshot } = useCompany();
  const accounts = useFinancialAccounts();
  const list = accounts.data ?? [];
  const allocation = useAllocationOptions(list);
  const [accountId, setAccountId] = useState(presetAccount ?? "");
  const [kind, setKind] = useState(direction === "in" ? "RECEIPT" : "PAYMENT");
  const [transactionDate, setTransactionDate] = useState(isoDay());
  const [partyName, setPartyName] = useState("");
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [chequeNumber, setChequeNumber] = useState("");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<Line[]>([{ accountId: "", amount: "", description: "" }]);
  const { busy, error, setError, run } = useSubmit(onSaved);

  const account = list.find((a) => a.id === accountId);
  const onlyAccountId = list.length === 1 ? list[0].id : "";
  useEffect(() => {
    if (!accountId && onlyAccountId) setAccountId(onlyAccountId);
  }, [accountId, onlyAccountId]);
  useEffect(() => {
    if (account) setMethod(isCash(account.kind) ? "CASH" : account.kind === "MOBILE_MONEY" ? "MOBILE_MONEY" : "BANK_TRANSFER");
  }, [account]);

  function changeKind(next: string) {
    setKind(next);
    const mapped = next === "BANK_CHARGE" ? snapshot?.defaults?.bankChargesId : next === "INTEREST" ? snapshot?.defaults?.interestIncomeId : null;
    if (mapped) setLines((ls) => (ls.length === 1 && !ls[0].accountId ? [{ ...ls[0], accountId: mapped }] : ls));
  }

  const total = lines.reduce((s, l) => s + (parseAmount(l.amount) || 0), 0);
  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const short = direction === "out" && account && !account.allowOverdraft && total > account.balance + 0.001;

  function submit(e: FormEvent) {
    e.preventDefault();
    const rows = lines
      .map((l) => ({ accountId: l.accountId, amount: parseAmount(l.amount), description: l.description.trim() || undefined }))
      .filter((l) => l.accountId || Number.isFinite(l.amount));
    if (!rows.length || rows.some((r) => !r.accountId || !Number.isFinite(r.amount) || r.amount <= 0)) {
      setError("Each line needs an account and an amount above zero.");
      return;
    }
    void run(async () => {
      const txn = await api<BankTransaction>(`/api/v1/banking/${direction === "in" ? "receipts" : "payments"}`, {
        method: "POST",
        body: JSON.stringify({
          financialAccountId: accountId,
          transactionDate,
          kind,
          lines: rows,
          method,
          reference: reference.trim() || undefined,
          chequeNumber: direction === "out" && method === "CHEQUE" ? chequeNumber.trim() || undefined : undefined,
          partyName: partyName.trim() || undefined,
          description: description.trim() || undefined,
        }),
      });
      return `${txn.number} posted as ${txn.journalNumber}`;
    });
  }

  const kinds = direction === "in" ? [{ value: "RECEIPT", label: "Money received" }, { value: "INTEREST", label: "Interest earned" }] : [{ value: "PAYMENT", label: "Payment" }, { value: "BANK_CHARGE", label: "Bank charge" }];

  return (
    <Drawer
      title={direction === "in" ? "Receive money" : "Make a payment"}
      subtitle={
        direction === "in"
          ? "For money that isn't a customer invoice payment — those go through Receivables."
          : "For spending that isn't a supplier bill — pay bills from Payables."
      }
      onClose={onClose}
      wide
      footer={<Footer onCancel={onClose} busy={busy} label={direction === "in" ? "Record receipt" : "Record payment"} formId="money-form" />}
    >
      <form id="money-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="form-grid">
          <Field label={direction === "in" ? "Paid into" : "Paid from"} required error={short ? `Only ${money(account!.balance, currency)} available and overdraft isn't allowed` : null}>
            <Select value={accountId} onChange={setAccountId} options={financialAccountOptions(list)} placeholder="Select an account…" required emptyText="Add a bank or cash account first" invalid={Boolean(short)} />
          </Field>
          <Field label="Type">
            <Select value={kind} onChange={changeKind} searchable={false} options={kinds} />
          </Field>
          <Field label="Date" required>
            <input className="input" type="date" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} required />
          </Field>
          <Field label={direction === "in" ? "Received from" : "Paid to"}>
            <input className="input" value={partyName} onChange={(e) => setPartyName(e.target.value)} maxLength={200} />
          </Field>
          <Field label="Method">
            <Select value={method} onChange={setMethod} searchable={false} options={BANK_METHODS} />
          </Field>
          {direction === "out" && method === "CHEQUE" ? (
            <Field label="Cheque number">
              <input className="input" value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} maxLength={40} />
            </Field>
          ) : (
            <Field label="Reference" hint="Transfer ID, slip or transaction number">
              <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />
            </Field>
          )}
          <Field label="Description" className="span-2">
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </Field>
        </div>

        <div className="form-section-title" style={{ marginTop: 22 }}>{direction === "in" ? "What the money is for" : "What the money was spent on"}</div>
        <div className="table-wrap">
          <table className="table lines-table">
            <thead>
              <tr>
                <th>Account</th>
                <th className="hide-sm">Note</th>
                <th className="num" style={{ width: 150 }}>
                  Amount
                </th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <Select value={l.accountId} onChange={(v) => setLine(i, { accountId: v })} options={allocation} placeholder="Select an account…" searchable aria-label={`Account for line ${i + 1}`} />
                  </td>
                  <td className="hide-sm">
                    <input className="input" value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} aria-label={`Note for line ${i + 1}`} />
                  </td>
                  <td>
                    <MoneyInput value={l.amount} onChange={(v) => setLine(i, { amount: v })} aria-label={`Amount for line ${i + 1}`} />
                  </td>
                  <td>
                    {lines.length > 1 && (
                      <button type="button" className="icon-button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remove line ${i + 1}`}>
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" className="btn btn-sm btn-quiet" style={{ marginTop: 8 }} onClick={() => setLines((ls) => [...ls, { accountId: "", amount: "", description: "" }])}>
          <Plus size={14} aria-hidden="true" />
          Add line
        </button>
        <SummaryRows rows={[[direction === "in" ? "Total received" : "Total paid", money(total, currency), true]]} />
      </form>
    </Drawer>
  );
}

/* ── Transfer ──────────────────────────────────────────── */

export function TransferForm({ fromAccountId, onClose, onSaved }: { fromAccountId?: string; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const { currency } = useCompany();
  const accounts = useFinancialAccounts();
  const list = accounts.data ?? [];
  const [fromId, setFromId] = useState(fromAccountId ?? "");
  const [toId, setToId] = useState("");
  const [transactionDate, setTransactionDate] = useState(isoDay());
  const [value, setValue] = useState("");
  const [fee, setFee] = useState("");
  const [reference, setReference] = useState("");
  const [chequeNumber, setChequeNumber] = useState("");
  const [description, setDescription] = useState("");
  const { busy, error, setError, run } = useSubmit(onSaved);

  const from = list.find((a) => a.id === fromId);
  const to = list.find((a) => a.id === toId);
  const n = parseAmount(value);
  const f = parseAmount(fee) || 0;
  const type = from && to ? transferTypeFor(from.kind, to.kind) : null;
  const short = from && !from.allowOverdraft && Number.isFinite(n) && n + f > from.balance + 0.001;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(n) || n <= 0) return;
    if (fromId === toId) return setError("Choose two different accounts.");
    void run(async () => {
      const txn = await api<BankTransaction>("/api/v1/banking/transfers", {
        method: "POST",
        body: JSON.stringify({
          fromAccountId: fromId,
          toAccountId: toId,
          transactionDate,
          amount: n,
          fee: f || undefined,
          reference: reference.trim() || undefined,
          chequeNumber: chequeNumber.trim() || undefined,
          description: description.trim() || undefined,
        }),
      });
      return `${txnLabel(txn)} ${txn.number} posted`;
    });
  }

  return (
    <Drawer
      title="Move money between accounts"
      subtitle="Deposits, withdrawals, petty cash top-ups and bank-to-bank transfers."
      onClose={onClose}
      footer={<Footer onCancel={onClose} busy={busy} label="Record transfer" formId="transfer-form" />}
    >
      <form id="transfer-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="form-grid">
          <Field label="From" required className="span-2" error={short ? `Only ${money(from!.balance, currency)} available and overdraft isn't allowed` : null}>
            <Select value={fromId} onChange={setFromId} options={financialAccountOptions(list)} placeholder="Select an account…" required invalid={Boolean(short)} />
          </Field>
          <Field label="To" required className="span-2" hint={type ? TRANSFER_LABELS[type] : undefined}>
            <Select value={toId} onChange={setToId} options={financialAccountOptions(list, (a) => a.id !== fromId && (!from || a.currency === from.currency))} placeholder="Select an account…" required />
          </Field>
          <Field label={`Amount (${currency})`} required>
            <MoneyInput value={value} onChange={setValue} required />
          </Field>
          <Field label="Date" required>
            <input className="input" type="date" value={transactionDate} onChange={(e) => setTransactionDate(e.target.value)} required />
          </Field>
          <Field label="Bank fee" hint="Charged on top of the amount, to bank charges">
            <MoneyInput value={fee} onChange={setFee} placeholder="0" />
          </Field>
          <Field label="Reference" hint="Deposit slip or transfer ID">
            <input className="input" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} />
          </Field>
          {from?.kind === "BANK" && (
            <Field label="Cheque number" hint="When cash is withdrawn by cheque">
              <input className="input" value={chequeNumber} onChange={(e) => setChequeNumber(e.target.value)} maxLength={40} />
            </Field>
          )}
          <Field label="Description" className="span-2">
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={from && to && type ? `${TRANSFER_LABELS[type]}: ${from.name} to ${to.name}` : undefined} />
          </Field>
        </div>
        {Number.isFinite(n) && n > 0 && from && to && (
          <SummaryRows
            rows={[
              [`Leaves ${from.name}`, amount(n + f)],
              [`Arrives in ${to.name}`, amount(n)],
              ...(f ? ([["Bank fee", amount(f)]] as Array<[string, string]>) : []),
            ]}
          />
        )}
      </form>
    </Drawer>
  );
}

/* ── Cash count ────────────────────────────────────────── */

export function CashCountForm({ account, onClose, onSaved }: { account: FinancialAccount; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const { currency, accounts: gl, snapshot } = useCompany();
  const [countDate, setCountDate] = useState(isoDay());
  const [counted, setCounted] = useState("");
  const [overShortAccountId, setOverShortAccountId] = useState(snapshot?.defaults?.suspenseAccountId ?? "");
  const [description, setDescription] = useState("");
  const { busy, error, run } = useSubmit(onSaved);
  const options = useMemo(() => accountOptions(gl.filter((a) => a.isActive && a.id !== account.glAccountId)), [gl, account.glAccountId]);

  const n = parseAmount(counted);
  const today = countDate === isoDay();
  const difference = Number.isFinite(n) ? n - account.balance : 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!Number.isFinite(n) || n < 0) return;
    void run(async () => {
      const txn = await api<BankTransaction>("/api/v1/banking/cash-counts", {
        method: "POST",
        body: JSON.stringify({ financialAccountId: account.id, countDate, counted: n, overShortAccountId: overShortAccountId || undefined, description: description.trim() || undefined }),
      });
      const diff = (txn.countedAmount ?? 0) - (txn.bookAmount ?? 0);
      return Math.abs(diff) < 0.005 ? `Count agrees with the books` : `${txn.number}: cash ${diff > 0 ? "over" : "short"} by ${money(Math.abs(diff), currency)}`;
    });
  }

  return (
    <Drawer
      title={`Count ${account.name}`}
      subtitle="Compares the cash in hand with the books and posts any difference."
      onClose={onClose}
      footer={<Footer onCancel={onClose} busy={busy} label="Record count" formId="count-form" />}
    >
      <form id="count-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="form-grid">
          <Field label="Count date" required>
            <input className="input" type="date" value={countDate} max={isoDay()} onChange={(e) => setCountDate(e.target.value)} required />
          </Field>
          <Field label={`Cash counted (${currency})`} required>
            <MoneyInput value={counted} onChange={setCounted} required />
          </Field>
          <Field label="Post any difference to" className="span-2" hint="Usually a cash over/short or suspense account. Needed only when the count differs.">
            <Select value={overShortAccountId} onChange={setOverShortAccountId} options={[{ value: "", label: "No account chosen" }, ...options]} searchable />
          </Field>
          <Field label="Note" className="span-2">
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </Field>
        </div>
        {today && Number.isFinite(n) && (
          <SummaryRows
            rows={[
              ["Balance in the books", amount(account.balance)],
              ["Cash counted", amount(n)],
              [
                Math.abs(difference) < 0.005 ? "Agrees" : difference > 0 ? "Over" : "Short",
                <span className={Math.abs(difference) < 0.005 ? "text-positive" : "text-negative"}>{amount(Math.abs(difference))}</span>,
                true,
              ],
            ]}
          />
        )}
        {!today && <p className="muted small" style={{ marginTop: 14 }}>The book balance at {date(countDate)} is worked out when you save.</p>}
      </form>
    </Drawer>
  );
}

/* ── Transaction detail & reversal ─────────────────────── */

export function TransactionDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const { api, can } = useSession();
  const { currency } = useCompany();
  const txn = useResource<BankTransaction>(`/api/v1/banking/transactions/${id}`);
  const [reversing, setReversing] = useState(false);
  const [reason, setReason] = useState("");
  const [reversalDate, setReversalDate] = useState(isoDay());
  const { busy, error, run } = useSubmit(() => {
    setReversing(false);
    txn.reload();
    onChanged();
  });
  const t = txn.data;

  function reverse(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const r = await api<BankTransaction>(`/api/v1/banking/transactions/${id}/reverse`, { method: "POST", body: JSON.stringify({ reason: reason.trim(), reversalDate }) });
      return `${r.number} reversed by ${r.reversalJournalNumber}`;
    });
  }

  const canReverse = t && t.status === "POSTED" && t.journalId && can("bank:manage");

  return (
    <Drawer
      title={t ? `${txnLabel(t)} ${t.number}` : "Transaction"}
      subtitle={t ? `${date(t.transactionDate)} · ${t.financialAccountName}${t.counterAccountName ? ` → ${t.counterAccountName}` : ""}` : undefined}
      onClose={onClose}
      footer={
        reversing ? (
          <Footer onCancel={() => setReversing(false)} busy={busy} label="Reverse transaction" formId="reverse-form" danger />
        ) : canReverse ? (
          <button type="button" className="btn btn-danger" onClick={() => setReversing(true)}>
            Reverse
          </button>
        ) : undefined
      }
    >
      {!t ? (
        <p className="muted">{txn.error ?? "Loading…"}</p>
      ) : (
        <>
          {t.status === "REVERSED" && (
            <div className="notice" style={{ marginBottom: 16 }}>
              Reversed on {date(t.reversedAt)} by {t.reversalJournalNumber}
              {t.reversalReason ? ` — ${t.reversalReason}` : ""}
            </div>
          )}
          <dl className="dl">
            <dt>Amount</dt>
            <dd className="strong">{money(t.kind === "CASH_COUNT" ? (t.countedAmount ?? 0) - (t.bookAmount ?? 0) : t.amount, currency)}</dd>
            {t.fee > 0 && (
              <>
                <dt>Bank fee</dt>
                <dd>{money(t.fee, currency)}</dd>
              </>
            )}
            {t.kind === "CASH_COUNT" && (
              <>
                <dt>Counted</dt>
                <dd>{money(t.countedAmount, currency)}</dd>
                <dt>In the books</dt>
                <dd>{money(t.bookAmount, currency)}</dd>
              </>
            )}
            {t.partyName && (
              <>
                <dt>{t.kind === "RECEIPT" ? "Received from" : "Paid to"}</dt>
                <dd>{t.partyName}</dd>
              </>
            )}
            {t.method && (
              <>
                <dt>Method</dt>
                <dd>{BANK_METHODS.find((m) => m.value === t.method)?.label ?? t.method}</dd>
              </>
            )}
            {t.reference && (
              <>
                <dt>Reference</dt>
                <dd>{t.reference}</dd>
              </>
            )}
            {t.chequeNumber && (
              <>
                <dt>Cheque</dt>
                <dd>{t.chequeNumber}</dd>
              </>
            )}
            <dt>Description</dt>
            <dd>{t.description || "—"}</dd>
            <dt>Journal</dt>
            <dd>{t.journalId ? <Link to={`/journals?id=${t.journalId}`}>{t.journalNumber}</Link> : <span className="muted">Nothing posted — the count agreed</span>}</dd>
            <dt>Recorded</dt>
            <dd>{dateTime(t.createdAt)}</dd>
          </dl>
          {t.lines.length > 0 && (
            <>
              <div className="form-section-title" style={{ marginTop: 22 }}>Allocated to</div>
              <div className="table-wrap">
                <table className="table">
                  <tbody>
                    {t.lines.map((l, i) => (
                      <tr key={i}>
                        <td>
                          <span className="mono muted">{l.accountCode}</span> {l.accountName ?? "Account not set"}
                          {l.description && <span className="sub">{l.description}</span>}
                        </td>
                        <td className="num">{amount(l.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          {reversing && (
            <form id="reverse-form" onSubmit={reverse} style={{ marginTop: 22 }}>
              <div className="form-section-title">Reverse this transaction</div>
              <FormError message={error} />
              <p className="muted small" style={{ marginBottom: 12 }}>
                A reversing journal is posted on the date you choose. The original stays in the books so the history is complete.
              </p>
              <div className="form-grid">
                <Field label="Reason" required className="span-2">
                  <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} minLength={3} maxLength={300} required />
                </Field>
                <Field label="Reversal date" required>
                  <input className="input" type="date" value={reversalDate} min={t.transactionDate.slice(0, 10)} onChange={(e) => setReversalDate(e.target.value)} required />
                </Field>
              </div>
            </form>
          )}
        </>
      )}
    </Drawer>
  );
}

/* ── Statement import ──────────────────────────────────── */

const PREVIEW_STATUS: Record<StatementPreview["lines"][number]["status"], { label: string; tone: "positive" | "neutral" | "warning" }> = {
  NEW: { label: "New", tone: "positive" },
  DUPLICATE: { label: "Already imported", tone: "neutral" },
  RECONCILED_PERIOD: { label: "Reconciled period", tone: "warning" },
  BEFORE_START: { label: "Before reconcile-from", tone: "warning" },
};

export function StatementImportForm({ account, onClose, onSaved }: { account: FinancialAccount; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const { currency } = useCompany();
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [dateOrder, setDateOrder] = useState("DMY");
  const [preview, setPreview] = useState<StatementPreview | null>(null);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState("");
  const { busy, error, run } = useSubmit(onSaved);

  useEffect(() => {
    if (!file) return;
    let live = true;
    setReading(true);
    setReadError("");
    api<StatementPreview>(`/api/v1/banking/accounts/${account.id}/statements/preview`, {
      method: "POST",
      body: JSON.stringify({ fileName: file.name, content: file.content, dateOrder }),
    })
      .then((p) => {
        if (live) setPreview(p);
      })
      .catch((e: Error) => {
        if (!live) return;
        setPreview(null);
        setReadError(e.message);
      })
      .finally(() => {
        if (live) setReading(false);
      });
    return () => {
      live = false;
    };
  }, [file, dateOrder, api, account.id]);

  async function pick(f: File | undefined) {
    setPreview(null);
    setReadError("");
    if (!f) return setFile(null);
    if (f.size > 6_500_000) return setReadError("The file is larger than 6.5 MB. Export a shorter period.");
    if (/\.(xlsx?|ods)$/i.test(f.name)) return setReadError("Excel files can't be read directly. Save the sheet as CSV and choose that file.");
    setFile({ name: f.name, content: await f.text() });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!file || !preview?.counts.new) return;
    void run(async () => {
      const r = await api<{ imported: number; skipped: number; autoMatched: number }>(`/api/v1/banking/accounts/${account.id}/statements`, {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, content: file.content, dateOrder }),
      });
      return `Imported ${r.imported} line${r.imported === 1 ? "" : "s"}${r.skipped ? `, skipped ${r.skipped}` : ""}. ${r.autoMatched} matched automatically.`;
    });
  }

  const inTotal = preview?.lines.filter((l) => l.status === "NEW" && l.amount > 0).reduce((s, l) => s + l.amount, 0) ?? 0;
  const outTotal = preview?.lines.filter((l) => l.status === "NEW" && l.amount < 0).reduce((s, l) => s - l.amount, 0) ?? 0;

  return (
    <Drawer
      title={`Import statement for ${account.name}`}
      subtitle="CSV, OFX/QFX, QIF or CAMT.053 (ISO 20022 XML) as exported from online banking."
      onClose={onClose}
      wide
      footer={<Footer onCancel={onClose} busy={busy || reading} label={preview ? `Import ${preview.counts.new} line${preview.counts.new === 1 ? "" : "s"}` : "Import"} formId="statement-form" />}
    >
      <form id="statement-form" onSubmit={submit}>
        <FormError message={error || readError} />
        <div className="form-grid">
          <Field label="Statement file" required className="span-2">
            <input className="input" type="file" accept=".csv,.txt,.ofx,.qfx,.qif,.xml,.xls,.xlsx" onChange={(e) => void pick(e.target.files?.[0])} required style={{ paddingTop: 6 }} />
          </Field>
          <Field label="Dates in the file are" hint="Only matters for CSV and QIF dates like 03/04/2026">
            <Select
              value={dateOrder}
              onChange={setDateOrder}
              searchable={false}
              options={[
                { value: "DMY", label: "Day / month / year" },
                { value: "MDY", label: "Month / day / year" },
              ]}
            />
          </Field>
        </div>

        {reading && <p className="muted small" style={{ marginTop: 16 }}>Reading the file…</p>}
        {preview && (
          <>
            <dl className="report-summary">
              <div>
                <dt>Format</dt>
                <dd>{preview.format === "CAMT053" ? "CAMT.053" : preview.format}</dd>
              </div>
              {preview.periodStart && (
                <div>
                  <dt>Period</dt>
                  <dd>
                    {date(preview.periodStart)} – {date(preview.periodEnd)}
                  </dd>
                </div>
              )}
              {preview.closingBalance !== null && (
                <div>
                  <dt>Closing balance</dt>
                  <dd>{money(preview.closingBalance, currency)}</dd>
                </div>
              )}
              <div>
                <dt>New lines</dt>
                <dd>{preview.counts.new}</dd>
              </div>
              <div>
                <dt>Money in / out</dt>
                <dd>
                  {amount(inTotal)} / {amount(outTotal)}
                </dd>
              </div>
            </dl>
            {preview.counts.new === 0 && preview.lines.length > 0 && (
              <div className="notice" style={{ marginTop: 14, marginBottom: 0 }}>
                Nothing new: every line is already imported, falls in a reconciled period, or is before the reconcile-from date.
              </div>
            )}
            {preview.errors.length > 0 && (
              <div className="notice error" style={{ marginTop: 14, marginBottom: 0, display: "block" }}>
                <strong>{preview.errors.length} line{preview.errors.length === 1 ? "" : "s"} couldn't be read and will be left out</strong>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {preview.errors.slice(0, 5).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
            {preview.lines.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 14, maxHeight: 360, overflowY: "auto" }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Description</th>
                      <th className="num">Amount</th>
                      <th className="hide-sm" />
                    </tr>
                  </thead>
                  <tbody>
                    {preview.lines.map((l, i) => (
                      <tr key={i} className={l.status === "NEW" ? undefined : "row-inactive"}>
                        <td className="nowrap">{date(l.transactionDate)}</td>
                        <td>
                          {l.description}
                          {(l.reference || l.chequeNumber) && <span className="sub">{[l.reference, l.chequeNumber && `Cheque ${l.chequeNumber}`].filter(Boolean).join(" · ")}</span>}
                        </td>
                        <td className={`num ${l.amount > 0 ? "text-positive" : ""}`}>{amount(l.amount, l.amount % 1 ? 2 : 0)}</td>
                        <td className="hide-sm">
                          <Badge tone={PREVIEW_STATUS[l.status].tone}>{PREVIEW_STATUS[l.status].label}</Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </form>
    </Drawer>
  );
}

/* ── Start a reconciliation ────────────────────────────── */

export function StartReconciliationForm({ accountId: preset, onClose }: { accountId?: string; onClose: () => void }) {
  const { api } = useSession();
  const { currency } = useCompany();
  const accounts = useFinancialAccounts();
  const list = (accounts.data ?? []).filter((a) => hasStatement(a.kind) && !a.openReconciliation);
  const [accountId, setAccountId] = useState(preset ?? "");
  const [statementDate, setStatementDate] = useState(isoDay());
  const [balance, setBalance] = useState("");
  const [touched, setTouched] = useState(false);
  const [notes, setNotes] = useState("");
  const { busy, error, run } = useSubmit();
  const account = list.find((a) => a.id === accountId);
  const suggestion = useResource<{ balance: number | null; source: "STATEMENT" | "LINE" | null; lineDate?: string }>(
    accountId && statementDate ? `/api/v1/banking/accounts/${accountId}/statement-balance?date=${statementDate}` : null,
  );

  useEffect(() => {
    if (!touched && suggestion.data?.balance !== null && suggestion.data?.balance !== undefined) setBalance(amount(suggestion.data.balance, suggestion.data.balance % 1 ? 2 : 0));
  }, [suggestion.data, touched]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = parseAmount(balance);
    if (!Number.isFinite(n)) return;
    void run(async () => {
      const rec = await api<Reconciliation>("/api/v1/banking/reconciliations", {
        method: "POST",
        body: JSON.stringify({ financialAccountId: accountId, statementDate, statementBalance: n, notes: notes.trim() || undefined }),
      });
      navigate(`/banking/reconciliation/${rec.id}`);
      return `${rec.number} started`;
    });
  }

  const minDate = account?.lastReconciledTo ? isoDay(new Date(new Date(account.lastReconciledTo).getTime() + 86_400_000)) : account?.reconcileFrom.slice(0, 10);

  return (
    <Drawer
      title="Start a bank reconciliation"
      subtitle="Agree the books to the bank statement at a date."
      onClose={onClose}
      footer={<Footer onCancel={onClose} busy={busy} label="Start reconciliation" formId="start-rec-form" />}
    >
      <form id="start-rec-form" onSubmit={submit}>
        <FormError message={error} />
        <div className="form-grid">
          <Field label="Account" required className="span-2" hint={account?.lastReconciledTo ? `Last reconciled to ${date(account.lastReconciledTo)}` : account ? "Not reconciled yet" : undefined}>
            <Select
              value={accountId}
              onChange={(v) => {
                setAccountId(v);
                setTouched(false);
              }}
              options={financialAccountOptions(list)}
              placeholder="Select an account…"
              required
              emptyText="No bank or mobile money account is free to reconcile"
            />
          </Field>
          <Field label="Statement date" required hint="Usually the last day of the statement">
            <input
              className="input"
              type="date"
              value={statementDate}
              min={minDate}
              onChange={(e) => {
                setStatementDate(e.target.value);
                setTouched(false);
              }}
              required
            />
          </Field>
          <Field
            label={`Closing balance on the statement (${currency})`}
            required
            hint={
              suggestion.data?.source === "STATEMENT"
                ? "From the imported statement's closing balance"
                : suggestion.data?.source === "LINE"
                  ? `From the running balance on ${date(suggestion.data.lineDate)}`
                  : "Type it from the bank statement"
            }
          >
            <MoneyInput
              value={balance}
              onChange={(v) => {
                setTouched(true);
                setBalance(v);
              }}
              required
            />
          </Field>
          <Field label="Notes" className="span-2">
            <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </form>
    </Drawer>
  );
}

/* ── Record a bank-only statement line ─────────────────── */

export function RecordLineForm({ line, onClose, onSaved }: { line: StatementLine; onClose: () => void; onSaved: () => void }) {
  const { api } = useSession();
  const { currency, accounts: gl, snapshot } = useCompany();
  const financial = useFinancialAccounts();
  const options = useAllocationOptions(financial.data ?? []);
  const kinds: StatementLineKind[] = line.amount < 0 ? ["BANK_CHARGE", "OTHER"] : ["INTEREST", "OTHER"];
  const [kind, setKind] = useState<StatementLineKind>(kinds.includes(line.suggestedKind) ? line.suggestedKind : "OTHER");
  const mapped = kind === "BANK_CHARGE" ? snapshot?.defaults?.bankChargesId : kind === "INTEREST" ? snapshot?.defaults?.interestIncomeId : null;
  const [accountId, setAccountId] = useState(mapped ?? "");
  const [description, setDescription] = useState(line.description);
  const { busy, error, run } = useSubmit(onSaved);
  const mappedAccount = gl.find((a) => a.id === mapped);

  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const txn = await api<BankTransaction>(`/api/v1/banking/statement-lines/${line.id}/record`, {
        method: "POST",
        body: JSON.stringify({ kind, accountId: accountId || undefined, description: description.trim() || undefined }),
      });
      return `${txn.number} posted and matched`;
    });
  }

  return (
    <Drawer
      title="Record in the books"
      subtitle={`${date(line.date)} · ${line.description} · ${money(line.amount, currency, line.amount % 1 ? 2 : 0)}`}
      onClose={onClose}
      footer={<Footer onCancel={onClose} busy={busy} label="Post and match" formId="record-line-form" />}
    >
      <form id="record-line-form" onSubmit={submit}>
        <FormError message={error} />
        <p className="muted small" style={{ marginBottom: 14 }}>
          For items the bank recorded that aren't in the books yet, such as charges and interest. A {line.amount < 0 ? "payment" : "receipt"} is posted on the statement date and matched to this line.
        </p>
        <div className="form-grid">
          <Field label="What is it?" className="span-2">
            <div className="segmented" role="group" aria-label="Item type">
              {kinds.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={kind === k ? "on" : ""}
                  onClick={() => {
                    setKind(k);
                    const next = k === "BANK_CHARGE" ? snapshot?.defaults?.bankChargesId : k === "INTEREST" ? snapshot?.defaults?.interestIncomeId : null;
                    setAccountId(next ?? "");
                  }}
                >
                  {LINE_KIND_LABELS[k]}
                </button>
              ))}
            </div>
          </Field>
          <Field
            label="Account"
            required={kind === "OTHER" || !mapped}
            className="span-2"
            hint={mappedAccount && accountId === mapped ? `Mapped in Company setup as the ${kind === "BANK_CHARGE" ? "bank charges" : "interest income"} account` : undefined}
          >
            <Select value={accountId} onChange={setAccountId} options={options} placeholder="Select an account…" searchable required={kind === "OTHER" || !mapped} />
          </Field>
          <Field label="Description" className="span-2">
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} />
          </Field>
        </div>
      </form>
    </Drawer>
  );
}

/** Optional bank or cash account for a customer receipt or supplier payment; hidden when Banking isn't set up. */
export function SettlementAccountField({ label, value, onChange }: { label: string; value: string; onChange: (id: string) => void }) {
  const accounts = useFinancialAccounts();
  if (!accounts.data?.length) return null;
  return (
    <Field label={label} hint="Leave on the default to use the ledger account mapped for the payment method">
      <Select value={value} onChange={onChange} options={[{ value: "", label: "Default for the payment method" }, ...financialAccountOptions(accounts.data)]} />
    </Field>
  );
}

export function useConfirmAction() {
  const { confirm, toast } = useFeedback();
  return async function act(opts: { title: string; body?: string; confirmLabel: string; danger?: boolean }, action: () => Promise<string>, after?: () => void) {
    if (!(await confirm(opts))) return;
    try {
      toast(await action());
      after?.();
    } catch (e) {
      toast((e as Error).message, { error: true });
    }
  };
}
