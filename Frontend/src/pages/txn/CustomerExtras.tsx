import { X } from "lucide-react";
import { useMemo, useState } from "react";
import { AddCustomerDrawer } from "../../components/customers/AddCustomerDrawer";
import { useFeedback } from "../../components/feedback";
import { Select } from "../../components/Select";
import { CancelButton, ErrorBanner, HeaderBand, PartySelect, SplitButton, TField, TxnFooter, TxnPage, useValidation } from "../../components/txn/TxnKit";
import { useCompany } from "../../lib/company";
import { amount, isoDay, toNumber } from "../../lib/format";
import { navigate, useLocation } from "../../lib/router";
import { useResource, useSession } from "../../lib/session";
import { customerOptions, emailListValid, indexTxn, monthsAgo, newId, rwf, saveLocal, useCustomers } from "../../lib/txn";
import type { ArInvoiceList } from "../../lib/types";
import { yup } from "../../lib/validation";

/* ── Create statements (111) ───────────────────────────── */

const STATEMENT_TYPES = [
  { value: "BALANCE_FORWARD", label: "Balance Forward" },
  { value: "OPEN_ITEM", label: "Open Item (last 365 days)" },
  { value: "TRANSACTION", label: "Transaction Statement" },
];
const BALANCE_STATUS = [
  { value: "OPEN", label: "Open" },
  { value: "OVERDUE", label: "Overdue" },
  { value: "ALL", label: "All" },
];

export function StatementForm() {
  const { download, api } = useSession();
  const { toast } = useFeedback();
  const { currency } = useCompany();
  const { customers, loading } = useCustomers();
  const v = useValidation();
  const end = isoDay();
  // From the customer list's bulk action: /sales/statement/new?customers=id1,id2
  const { query } = useLocation();
  const [only] = useState(() => new Set((query.get("customers") ?? "").split(",").filter(Boolean)));
  const [form, setForm] = useState({ statementDate: end, type: "BALANCE_FORWARD", status: only.size ? "ALL" : "OPEN", startDate: monthsAgo(end, 1), endDate: end });
  const [deselected, setDeselected] = useState<Set<string>>(new Set());
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const overdue = useResource<ArInvoiceList>(form.status === "OVERDUE" ? "/api/v1/ar/invoices?status=OVERDUE&pageSize=500" : null);

  const recipients = useMemo(() => {
    if (only.size && form.status === "ALL") return customers.filter((c) => only.has(c.id));
    if (form.status === "ALL") return customers;
    if (form.status === "OVERDUE") {
      const ids = new Set((overdue.data?.rows ?? []).map((r) => r.customerId));
      return customers.filter((c) => ids.has(c.id));
    }
    return customers.filter((c) => toNumber(c.balance) > 0);
  }, [customers, form.status, overdue.data, only]);

  const selected = recipients.filter((c) => !deselected.has(c.id));
  const total = selected.reduce((s, c) => s + toNumber(c.balance), 0);
  const allOn = recipients.length > 0 && selected.length === recipients.length;
  const emailOf = (id: string, fallback: string | null) => emails[id] ?? fallback ?? "";
  const dated = form.type !== "OPEN_ITEM";

  const schema = yup.object({
    statementDate: yup.string().required("Choose the statement date"),
    startDate: yup.string().test("start", "Choose a start date", (val) => !dated || Boolean(val)),
    endDate: yup
      .string()
      .test("end", "Choose an end date", (val) => !dated || Boolean(val))
      .test("order", "End date can't be before the start date", function (val) {
        return !dated || !val || !this.parent.startDate || val >= this.parent.startDate;
      }),
  });

  const set = (k: keyof typeof form) => (val: string) => (setForm((f) => ({ ...f, [k]: val })), v.clear(k));

  async function save(mode: "save" | "send" | "print") {
    setError("");
    if (!(await v.validate(schema, form))) return;
    if (!selected.length) return setError("Select at least one recipient.");
    if (mode === "send") {
      const missing = selected.filter((c) => !emailOf(c.id, c.email).trim());
      if (missing.length) return setError(`Add an email for ${missing.map((c) => c.name).join(", ")} or deselect them.`);
      const bad = selected.find((c) => !emailListValid(emailOf(c.id, c.email)));
      if (bad) return setError(`${bad.name}'s email address isn't valid.`);
    }
    setBusy(true);
    try {
      const from = dated ? form.startDate : monthsAgo(form.statementDate, 12);
      const to = dated ? form.endDate : form.statementDate;
      let emailed = 0;
      const failed: string[] = [];
      if (mode === "send") {
        // Each customer gets their own email with their statement PDF, sent by the server.
        for (const c of selected) {
          try {
            await api(`/api/v1/ar/customers/${c.id}/statement/email`, { method: "POST", body: JSON.stringify({ to: emailOf(c.id, c.email), from, toDate: to }) });
            emailed += 1;
          } catch (e) {
            failed.push(`${c.name}: ${(e as Error).message}`);
          }
        }
      } else if (mode === "print") {
        for (const c of selected) await download(`/api/v1/ar/customers/${c.id}/statement.pdf?from=${from}&to=${to}`, `Statement-${c.code}-${to}.pdf`);
      }
      const id = newId();
      saveLocal("statement", { id, ...form, recipients: selected.map((c) => ({ id: c.id, name: c.name, email: emailOf(c.id, c.email), balance: toNumber(c.balance) })), total, createdAt: new Date().toISOString() });
      indexTxn({ id, kind: "statement", number: "", date: form.statementDate, party: `${selected.length} customer${selected.length > 1 ? "s" : ""}`, amount: total, memo: STATEMENT_TYPES.find((t) => t.value === form.type)?.label ?? "", status: mode === "send" ? "Sent" : "Saved", posted: false });
      if (mode === "send") {
        if (failed.length) {
          setError(`${emailed} sent. Not sent: ${failed.join("; ")}`);
          return;
        }
        toast(`${emailed} statement${emailed === 1 ? "" : "s"} emailed`);
      } else toast(mode === "print" ? `${selected.length} statement PDF${selected.length > 1 ? "s" : ""} downloaded` : "Statements saved");
      navigate("/customers");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <TxnPage
      title="Create statements"
      kind="statement"
      onClose={() => navigate("/customers")}
      actions={["feedback", "help", "close"]}
      feedbackLabel="Give feedback"
      footer={
        <TxnFooter
          left={<CancelButton tone="blue" onClick={() => navigate("/customers")} />}
          right={
            <>
              <SplitButton label="Save" variant="secondary" onClick={() => void save("save")} disabled={!selected.length} busy={busy} />
              <SplitButton label="Save and send" onClick={() => void save("send")} disabled={!selected.length} busy={busy} items={[{ label: "Save and print", onSelect: () => void save("print") }]} />
            </>
          }
        />
      }
    >
      <ErrorBanner message={error} onClose={() => setError("")} />
      <HeaderBand collapsible={false} amountLabel="" aside={<><span style={{ fontSize: 17 }}>Total balance for selected customers</span><strong className="txn-amount">{rwf(total, currency)}</strong></>}>
        <div className="txn-row">
          <TField label="Statement date" required error={v.errors.statementDate} className="w-md">
            <input className="txn-input" type="date" value={form.statementDate} onChange={(e) => set("statementDate")(e.target.value)} />
          </TField>
          <TField label="Statement type" className="w-lg">
            <Select value={form.type} onChange={set("type")} options={STATEMENT_TYPES} searchable={false} />
          </TField>
        </div>
        <div className="txn-row">
          <TField label="Customer balance status" className="w-md">
            <Select value={form.status} onChange={(s) => (set("status")(s), setDeselected(new Set()))} options={BALANCE_STATUS} searchable={false} />
          </TField>
          {dated ? (
            <>
              <TField label="Start date" required error={v.errors.startDate} className="w-md">
                <input className="txn-input" type="date" value={form.startDate} onChange={(e) => set("startDate")(e.target.value)} />
              </TField>
              <TField label="End date" required error={v.errors.endDate} className="w-md">
                <input className="txn-input" type="date" value={form.endDate} min={form.startDate} onChange={(e) => set("endDate")(e.target.value)} />
              </TField>
            </>
          ) : null}
        </div>
      </HeaderBand>

      <table className="txn-table">
        <thead>
          <tr>
            <th style={{ width: 60 }}>
              <input
                type="checkbox"
                aria-label="Select all recipients"
                checked={allOn || recipients.length === 0}
                onChange={(e) => setDeselected(e.target.checked ? new Set() : new Set(recipients.map((c) => c.id)))}
              />
            </th>
            <th style={{ paddingLeft: 90 }}>Recipients</th>
            <th>Email Address</th>
            <th className="right">Balance</th>
          </tr>
        </thead>
        <tbody>
          {loading || overdue.loading ? (
            <tr>
              <td colSpan={4} className="muted">
                Loading customers…
              </td>
            </tr>
          ) : recipients.length === 0 ? (
            <tr>
              <td colSpan={4}>
                <div className="txn-empty">
                  <h3>
                    <span className="txn-empty-icon">!</span> We couldn't create a statement based on the options you selected
                  </h3>
                  <p>Adjust your selection and try again.</p>
                </div>
              </td>
            </tr>
          ) : (
            recipients.map((c) => (
              <tr key={c.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Include ${c.name}`}
                    checked={!deselected.has(c.id)}
                    onChange={(e) =>
                      setDeselected((d) => {
                        const next = new Set(d);
                        if (e.target.checked) next.delete(c.id);
                        else next.add(c.id);
                        return next;
                      })
                    }
                  />
                </td>
                <td style={{ paddingLeft: 90 }}>{c.name}</td>
                <td>
                  <input className={`txn-input ${emailOf(c.id, c.email) && !emailListValid(emailOf(c.id, c.email)) ? "invalid" : ""}`} value={emailOf(c.id, c.email)} placeholder="Add email" onChange={(e) => setEmails((m) => ({ ...m, [c.id]: e.target.value }))} aria-label={`Email for ${c.name}`} />
                </td>
                <td className="right">{amount(toNumber(c.balance), 2)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </TxnPage>
  );
}

/* ── Create proposal (131) ─────────────────────────────── */

export function ProposalStart() {
  const { customers, reload } = useCustomers();
  const [mode, setMode] = useState<"customer" | "lead">("customer");
  const [customerId, setCustomerId] = useState("");
  const [lead, setLead] = useState({ name: "", email: "" });
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const leadValid = lead.name.trim().length > 1 && (!lead.email || emailListValid(lead.email));
  const ready = mode === "customer" ? Boolean(customerId) : leadValid;

  function proceed() {
    if (mode === "lead" && lead.email && !emailListValid(lead.email)) return setError("Enter a valid email");
    if (!ready) return setError(mode === "customer" ? "Select a customer" : "Enter the lead's name");
    const qs = mode === "customer" ? `customer=${customerId}` : `lead=${encodeURIComponent(lead.name.trim())}&leadEmail=${encodeURIComponent(lead.email.trim())}`;
    navigate(`/sales/proposal/new?${qs}`);
  }

  return (
    <div className="txn-page" style={{ background: "#b9c7dd" }}>
      <div className="txn-brand">
        <img src="/logo.jpeg" alt="" width={34} height={34} />
        <span className="txn-brand-sep" />
        <span>Excel Edge ERP</span>
      </div>
      <header className="txn-head" style={{ background: "#fff" }}>
        <h1 style={{ margin: 0, fontSize: 26, fontWeight: 800, color: "#0f1b8d" }}>Create proposal</h1>
        <button type="button" className="txn-icon" aria-label="Close" onClick={() => navigate("/invoices")}>
          <X size={24} />
        </button>
      </header>
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
        <div className="txn-modal" role="dialog" aria-modal="true" aria-label="Who's this proposal for?" style={{ maxWidth: 860, color: "#0f1b8d" }}>
          <div className="txn-modal-head">
            <h2 style={{ fontSize: 34 }}>Who's this proposal for?</h2>
            <button type="button" className="txn-icon" aria-label="Close" onClick={() => navigate("/invoices")}>
              <X size={26} />
            </button>
          </div>
          <div className="txn-modal-body" style={{ gap: 22 }}>
            <p style={{ margin: 0, fontSize: 21 }}>Choose a customer to create your proposal.</p>
            <div className="txn-segment" role="radiogroup" aria-label="Proposal recipient type">
              {(["customer", "lead"] as const).map((m) => (
                <button key={m} type="button" role="radio" aria-checked={mode === m} className={mode === m ? "on" : ""} onClick={() => (setMode(m), setError(""))} style={{ fontSize: 21, padding: "12px 30px" }}>
                  {m === "customer" ? "Customer" : "Lead"}
                </button>
              ))}
            </div>
            {mode === "customer" ? (
              <TField label="" error={error || undefined}>
                <PartySelect value={customerId} onChange={(id) => (setCustomerId(id), setError(""))} options={customerOptions(customers)} placeholder="Select a customer" addLabel="Add new customer" onAdd={() => setAdding(true)} invalid={Boolean(error)} />
              </TField>
            ) : (
              <div className="txn-form-grid">
                <TField label="Lead name" required error={error && !lead.name.trim() ? error : undefined}>
                  <input className="txn-input" value={lead.name} onChange={(e) => (setLead((l) => ({ ...l, name: e.target.value })), setError(""))} placeholder="Who are you pitching?" />
                </TField>
                <TField label="Email" error={lead.email && !emailListValid(lead.email) ? "Enter a valid email" : undefined}>
                  <input className="txn-input" value={lead.email} onChange={(e) => setLead((l) => ({ ...l, email: e.target.value }))} />
                </TField>
              </div>
            )}
          </div>
          <div className="txn-modal-foot">
            <button type="button" className="txn-btn-outline blue" onClick={() => navigate("/invoices")} style={{ fontSize: 20 }}>
              Cancel
            </button>
            <button type="button" className="txn-btn-primary" disabled={!ready} onClick={proceed} style={{ fontSize: 20 }}>
              Continue
            </button>
          </div>
        </div>
      </div>
      {adding ? (
        <AddCustomerDrawer
          onClose={() => setAdding(false)}
          onSaved={(c) => {
            setAdding(false);
            reload();
            setCustomerId(c.id);
          }}
        />
      ) : null}
    </div>
  );
}
