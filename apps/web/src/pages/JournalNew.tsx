import { Plus, X } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { MoneyInput, parseAmount } from "../components/forms";
import { useFeedback } from "../components/feedback";
import { Select, type SelectOption } from "../components/Select";
import { EmptyState, Field, FormSkeleton, PageHeader } from "../components/ui";
import type { ApprovalRequest, Dimension, JournalDetail } from "../lib/approvals";
import { useCompany } from "../lib/company";
import { amount, isoDay, toNumber } from "../lib/format";
import { navigate } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { Account, Journal } from "../lib/types";
import { accountOptions } from "./Accounts";

type BudgetWarning = { account: string; period: string; over: number; budget: number; actual: number };
type Line = { key: number; accountId: string; description: string; debit: string; credit: string; costCentre: string; project: string };

type SaveMode = "draft" | "submit" | "post";

let nextKey = 1;
const blank = (): Line => ({ key: nextKey++, accountId: "", description: "", debit: "", credit: "", costCentre: "", project: "" });

function dimensionOptions(dimensions: Dimension[], kind: Dimension["kind"], current: string[]): SelectOption[] {
  const active = dimensions.filter((d) => d.kind === kind && (d.isActive || current.includes(d.code)));
  return [{ value: "", label: "None" }, ...active.map((d) => ({ value: d.code, label: d.name, prefix: d.code }))];
}

/** New journal, or `id` to edit a draft. */
export function JournalNew({ id }: { id?: string }) {
  const existing = useResource<JournalDetail>(id ? `/api/v1/journals/${id}` : null);
  if (!id) return <JournalForm />;
  if (existing.error) {
    return (
      <div className="panel">
        <EmptyState title="This journal couldn't be loaded" body={existing.error} />
      </div>
    );
  }
  if (!existing.data) return <FormSkeleton />;
  if (existing.data.status !== "DRAFT") {
    return (
      <div className="panel">
        <EmptyState
          title={`${existing.data.journalNumber} can't be edited`}
          body="Only draft journals can be changed. A journal returned for correction goes back to draft."
          action={
            <button type="button" className="btn" onClick={() => navigate(`/journals?id=${id}`)}>
              View journal
            </button>
          }
        />
      </div>
    );
  }
  return <JournalForm key={id} journal={existing.data} />;
}

function JournalForm({ journal }: { journal?: JournalDetail }) {
  const { api, can } = useSession();
  const { toast } = useFeedback();
  const { currency, dashboard, activated } = useCompany();
  const accounts = useResource<Account[]>("/api/v1/coa?isActive=true");
  const dimensions = useResource<Dimension[]>("/api/v1/books/dimensions");
  const [journalDate, setJournalDate] = useState(journal ? journal.journalDate.slice(0, 10) : isoDay());
  const [referenceNumber, setReference] = useState(journal?.referenceNumber ?? "");
  const [description, setDescription] = useState(journal?.description ?? "");
  const [lines, setLines] = useState<Line[]>(() => {
    const loaded: Line[] = [...(journal?.lines ?? [])]
      .sort((a, b) => a.lineNumber - b.lineNumber)
      .map((l) => ({
        key: nextKey++,
        accountId: l.account.id,
        description: l.description ?? "",
        debit: toNumber(l.debit) ? amount(l.debit, toNumber(l.debit) % 1 ? 2 : 0) : "",
        credit: toNumber(l.credit) ? amount(l.credit, toNumber(l.credit) % 1 ? 2 : 0) : "",
        costCentre: l.costCentre ?? "",
        project: l.project ?? "",
      }));
    while (loaded.length < 2) loaded.push(blank());
    return loaded;
  });
  const [busy, setBusy] = useState<SaveMode | null>(null);
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);

  const options = useMemo(() => accountOptions((accounts.data ?? []).filter((a) => a.allowManualPost)), [accounts.data]);
  const dims = dimensions.data ?? [];
  const costCentreOptions = useMemo(() => dimensionOptions(dims, "COST_CENTRE", lines.map((l) => l.costCentre)), [dims, lines]);
  const projectOptions = useMemo(() => dimensionOptions(dims, "PROJECT", lines.map((l) => l.project)), [dims, lines]);
  const showCostCentre = costCentreOptions.length > 1;
  const showProject = projectOptions.length > 1;

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

  async function save(mode: SaveMode) {
    setAttempted(true);
    setError("");
    if (lines.some(lineError) || !balanced) {
      if (!balanced) setError(filled.length < 2 ? "A journal needs at least two lines." : "Debits and credits must be equal before saving.");
      return;
    }
    const body = {
      journalDate,
      referenceNumber: referenceNumber || undefined,
      description: description || undefined,
      currencyCode: journal?.currencyCode ?? currency,
      exchangeRate: journal?.exchangeRate != null ? toNumber(journal.exchangeRate) : undefined,
      branchId: journal?.branchId ?? undefined,
      lines: filled.map((l) => ({
        accountId: l.accountId,
        description: l.description || undefined,
        debit: parseAmount(l.debit) || 0,
        credit: parseAmount(l.credit) || 0,
        costCentre: l.costCentre || undefined,
        project: l.project || undefined,
      })),
    };
    setBusy(mode);
    try {
      let j: Journal;
      if (journal) {
        j = await api<Journal>(`/api/v1/journals/${journal.id}`, { method: "PUT", body: JSON.stringify(body) });
      } else {
        const created = await api<Journal & { budgetWarnings?: BudgetWarning[]; journal?: Journal & { budgetWarnings?: BudgetWarning[] } }>("/api/v1/journals", {
          method: "POST",
          body: JSON.stringify({ ...body, postImmediately: mode === "post" || undefined, submit: mode === "submit" || undefined }),
        });
        j = "journal" in created && created.journal ? created.journal : created;
      }
      let message = `${j.journalNumber} saved as draft`;
      let warnings: BudgetWarning[] = [];
      if (journal && mode === "submit") {
        const r = await api<{ journal: Journal; approval: ApprovalRequest | null }>(`/api/v1/journals/${j.id}/submit`, { method: "POST", body: "{}" });
        message = r.approval ? `${j.journalNumber} submitted for approval` : `${j.journalNumber} needs no approval and is ready to post`;
      } else if (journal && mode === "post") {
        try {
          const posted = await api<Journal & { budgetWarnings?: BudgetWarning[] }>(`/api/v1/journals/${j.id}/post`, { method: "POST", body: "{}" });
          warnings = posted.budgetWarnings ?? [];
        } catch (e) {
          toast(`Changes saved, but ${j.journalNumber} wasn't posted: ${(e as Error).message}`, { error: true });
          navigate(`/journals?id=${j.id}`);
          return;
        }
        message = `${j.journalNumber} posted`;
      } else if (mode === "submit") {
        message = j.status === "APPROVED" ? `${j.journalNumber} needs no approval and is ready to post` : `${j.journalNumber} submitted for approval`;
      } else if (mode === "post") {
        message = `${j.journalNumber} posted`;
        warnings = (j as Journal & { budgetWarnings?: BudgetWarning[] }).budgetWarnings ?? [];
      } else if (journal) {
        message = `${j.journalNumber} updated`;
      }
      toast(
        warnings.length
          ? `${message}. Budget warning: ${warnings.map((w) => `${w.account} over by ${amount(w.over)} in ${w.period}`).join("; ")}`
          : message,
      );
      navigate(`/journals?id=${j.id}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void save("submit");
  }

  const back = journal ? `/journals?id=${journal.id}` : "/journals";

  return (
    <form onSubmit={submit}>
      <PageHeader
        back={{ to: back, label: journal ? journal.journalNumber : "Journal entries" }}
        title={journal ? `Edit ${journal.journalNumber}` : "New journal entry"}
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
              <th style={{ width: showCostCentre || showProject ? "26%" : "34%" }}>Account</th>
              <th>Line description</th>
              {showCostCentre && <th style={{ width: 150 }}>Cost centre</th>}
              {showProject && <th style={{ width: 150 }}>Project</th>}
              <th className="num" style={{ width: 140 }}>
                Debit
              </th>
              <th className="num" style={{ width: 140 }}>
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
                  {showCostCentre && (
                    <td>
                      <Select value={l.costCentre} onChange={(v) => update(l.key, { costCentre: v })} options={costCentreOptions} placeholder="None" aria-label={`Cost centre for line ${i + 1}`} />
                    </td>
                  )}
                  {showProject && (
                    <td>
                      <Select value={l.project} onChange={(v) => update(l.key, { project: v })} options={projectOptions} placeholder="None" aria-label={`Project for line ${i + 1}`} />
                    </td>
                  )}
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
          <button type="button" className="btn" onClick={() => navigate(back)}>
            Cancel
          </button>
          <button type="button" className="btn" disabled={!!busy} onClick={() => void save("draft")}>
            {busy === "draft" ? "Saving…" : journal ? "Save changes" : "Save draft"}
          </button>
          {can("journal:post") && (
            <button
              type="button"
              className="btn"
              disabled={!!busy || !activated}
              title="Only works when this entry needs no approval and you're allowed to post it"
              onClick={() => void save("post")}
            >
              {busy === "post" ? "Posting…" : journal ? "Save and post" : "Post now"}
            </button>
          )}
          <button type="submit" className="btn btn-primary" disabled={!!busy}>
            {busy === "submit" ? "Submitting…" : journal?.approval?.status === "RETURNED" ? "Resubmit for approval" : "Submit for approval"}
          </button>
        </div>
      </div>
    </form>
  );
}
