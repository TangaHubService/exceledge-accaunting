import { Plus, X } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { MoneyInput, parseAmount } from "../components/forms";
import { useFeedback } from "../components/feedback";
import { Select } from "../components/Select";
import { Field, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, isoDay } from "../lib/format";
import { navigate } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { Account, Journal } from "../lib/types";
import { accountOptions } from "./Accounts";

type Line = { key: number; accountId: string; description: string; debit: string; credit: string };

let nextKey = 1;
const blank = (): Line => ({ key: nextKey++, accountId: "", description: "", debit: "", credit: "" });

export function JournalNew() {
  const { api, can } = useSession();
  const { toast } = useFeedback();
  const { currency, dashboard, activated } = useCompany();
  const accounts = useResource<Account[]>("/api/v1/coa?isActive=true");
  const [journalDate, setJournalDate] = useState(isoDay());
  const [referenceNumber, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [lines, setLines] = useState<Line[]>([blank(), blank()]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);

  const options = useMemo(() => accountOptions((accounts.data ?? []).filter((a) => a.allowManualPost)), [accounts.data]);

  const totalDebit = lines.reduce((s, l) => s + (parseAmount(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (parseAmount(l.credit) || 0), 0);
  const difference = Math.round((totalDebit - totalCredit) * 100) / 100;
  const filled = lines.filter((l) => l.accountId && ((parseAmount(l.debit) || 0) > 0 || (parseAmount(l.credit) || 0) > 0));
  const balanced = difference === 0 && totalDebit > 0 && filled.length >= 2;

  function update(key: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }

  function lineError(l: Line) {
    if (!attempted) return null;
    const d = parseAmount(l.debit) || 0;
    const c = parseAmount(l.credit) || 0;
    if (!l.accountId && (d || c)) return "Choose an account";
    if (l.accountId && !d && !c) return "Enter a debit or credit";
    if (d && c) return "Use either debit or credit";
    return null;
  }

  async function save(post: boolean) {
    setAttempted(true);
    setError("");
    if (lines.some(lineError) || !balanced) {
      if (!balanced) setError(filled.length < 2 ? "A journal needs at least two lines." : "Debits and credits must be equal before saving.");
      return;
    }
    setBusy(true);
    try {
      const j = await api<Journal>("/api/v1/journals", {
        method: "POST",
        body: JSON.stringify({
          journalDate,
          referenceNumber: referenceNumber || undefined,
          description: description || undefined,
          currencyCode: currency,
          postImmediately: post,
          lines: filled.map((l) => ({
            accountId: l.accountId,
            description: l.description || undefined,
            debit: parseAmount(l.debit) || 0,
            credit: parseAmount(l.credit) || 0,
          })),
        }),
      });
      toast(post ? `${j.journalNumber} posted` : `${j.journalNumber} saved as draft`);
      navigate(`/journals?id=${j.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void save(can("journal:post"));
  }

  return (
    <form onSubmit={submit}>
      <PageHeader
        back={{ to: "/journals", label: "Journal entries" }}
        title="New journal entry"
        description="For adjustments, accruals and corrections. Sales, invoices and payments post automatically."
      />

      {!activated && dashboard && (
        <div className="notice">Accounting isn't activated yet, so entries can't be posted. Finish company setup first.</div>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}

      <div className="panel panel-body">
        <div className="form-grid journal-head">
          <Field
            label="Date"
            required
            hint={dashboard?.currentOpenPeriod ? `Open period: ${dashboard.currentOpenPeriod.name}` : undefined}
          >
            <input className="input" type="date" value={journalDate} onChange={(e) => setJournalDate(e.target.value)} required />
          </Field>
          <Field label="Reference">
            <input className="input" value={referenceNumber} onChange={(e) => setReference(e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Description">
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. September rent accrual" />
          </Field>
        </div>
      </div>

      <div className="table-wrap section" style={{ marginTop: 16 }}>
        <table className="table lines-table">
          <thead>
            <tr>
              <th style={{ width: "34%" }}>Account</th>
              <th>Line description</th>
              <th className="num" style={{ width: 150 }}>
                Debit
              </th>
              <th className="num" style={{ width: 150 }}>
                Credit
              </th>
              <th style={{ width: 40 }}>
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const err = lineError(l);
              return (
                <tr key={l.key}>
                  <td>
                    <Select
                      invalid={err === "Choose an account"}
                      value={l.accountId}
                      onChange={(v) => update(l.key, { accountId: v })}
                      aria-label={`Account for line ${i + 1}`}
                      placeholder={accounts.data ? "Choose account…" : "Loading accounts…"}
                      emptyText={accounts.data ? "No accounts accept manual entries" : "Loading accounts…"}
                      options={options}
                    />
                    {err && <span className="field-error">{err}</span>}
                  </td>
                  <td>
                    <input className="input" value={l.description} onChange={(e) => update(l.key, { description: e.target.value })} aria-label={`Description for line ${i + 1}`} />
                  </td>
                  <td>
                    <MoneyInput value={l.debit} onChange={(v) => update(l.key, { debit: v, credit: v ? "" : l.credit })} aria-label={`Debit for line ${i + 1}`} />
                  </td>
                  <td>
                    <MoneyInput value={l.credit} onChange={(v) => update(l.key, { credit: v, debit: v ? "" : l.debit })} aria-label={`Credit for line ${i + 1}`} />
                  </td>
                  <td>
                    {lines.length > 2 && (
                      <button type="button" className="icon-button" onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Remove line ${i + 1}`}>
                        <X size={16} aria-hidden="true" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="balance-bar">
          <button type="button" className="btn btn-sm btn-quiet" style={{ marginRight: "auto" }} onClick={() => setLines((ls) => [...ls, blank()])}>
            <Plus size={14} aria-hidden="true" />
            Add line
          </button>
          <span>
            Debits <strong className="amount">{amount(totalDebit)}</strong>
          </span>
          <span>
            Credits <strong className="amount">{amount(totalCredit)}</strong>
          </span>
          <span className={difference === 0 ? "text-positive" : "text-negative"} style={{ minWidth: 150, textAlign: "right" }}>
            {difference === 0 ? (totalDebit > 0 ? "Balanced" : "") : <>Out by <strong className="amount">{amount(Math.abs(difference))}</strong></>}
          </span>
        </div>
      </div>

      <div className="page-header" style={{ justifyContent: "flex-end", marginTop: 16 }}>
        <div className="actions">
          <button type="button" className="btn" onClick={() => navigate("/journals")}>
            Cancel
          </button>
          {can("journal:post") ? (
            <>
              <button type="button" className="btn" disabled={busy} onClick={() => void save(false)}>
                Save as draft
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || !activated}>
                {busy ? "Posting…" : "Post entry"}
              </button>
            </>
          ) : (
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? "Saving…" : "Save as draft"}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}
