import { Play, Plus, Upload } from "lucide-react";
import { type ChangeEvent, type FormEvent, useMemo, useState } from "react";
import { useFeedback } from "../components/feedback";
import { Footer, FormError, MoneyInput, parseAmount, useSubmit } from "../components/forms";
import { Select } from "../components/Select";
import { accountOptions } from "../components/SetupForms";
import { Badge, Drawer, EmptyState, Field, Loadable, PageHeader } from "../components/ui";
import { useCompany } from "../lib/company";
import { amount, calendarDate, humanize, isoDay, plural, toNumber } from "../lib/format";
import { Link } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { Account } from "../lib/types";

type RecurringLine = { id: string; accountId: string; description: string | null; debit: string | number; credit: string | number };
type Recurring = {
  id: string;
  name: string;
  description: string | null;
  frequency: string;
  nextRunDate: string;
  endDate: string | null;
  autoPost: boolean;
  isActive: boolean;
  lines: RecurringLine[];
};
type RunResult = { generated: number; journalIds: string[]; failed: Array<{ templateId: string; name: string; error: string }> };

const FREQUENCIES = ["WEEKLY", "MONTHLY", "QUARTERLY", "YEARLY"].map((v) => ({ value: v, label: humanize(v) }));

export function RecurringJournals() {
  const { can, api } = useSession();
  const { toast, confirm } = useFeedback();
  const { currency } = useCompany();
  const list = useResource<Recurring[]>("/api/v1/books/recurring");
  const [creating, setCreating] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const today = isoDay();

  async function runDue() {
    const due = (list.data ?? []).filter((r) => r.isActive && r.nextRunDate.slice(0, 10) <= today).length;
    const ok = await confirm({
      title: "Run due recurring journals?",
      body: due ? `${plural(due, "template")} ${due === 1 ? "is" : "are"} due. Each creates a journal dated on its run date; templates set to auto-post are posted straight away.` : "No templates look due right now, but the run will check again.",
      confirmLabel: "Run now",
    });
    if (!ok) return;
    setRunning(true);
    try {
      const res = await api<RunResult>("/api/v1/books/recurring/run", { method: "POST", body: "{}" });
      setResult(res);
      toast(res.generated ? `${plural(res.generated, "journal")} created` : "Nothing was due");
      list.reload();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setRunning(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Recurring journals"
        description="Templates for journals that repeat, such as rent or depreciation accruals. Running them creates the journals that are due."
        actions={
          <>
            {can("journal:post") && (
              <button type="button" className="btn" disabled={running} onClick={() => void runDue()}>
                <Play size={16} aria-hidden="true" />
                {running ? "Running…" : "Run due now"}
              </button>
            )}
            {can("journal:create") && (
              <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
                <Plus size={16} aria-hidden="true" />
                New template
              </button>
            )}
          </>
        }
      />

      {result && (
        <div className={`notice ${result.failed.length ? "error" : "info"}`} role="status" style={{ marginBottom: 16 }}>
          <div className="grow">
            <strong>
              {plural(result.generated, "journal")} created{result.failed.length ? `, ${result.failed.length} failed` : ""}.
            </strong>{" "}
            {result.generated > 0 && <Link to="/journals">View journals</Link>}
            {result.failed.length > 0 && (
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {result.failed.map((f) => (
                  <li key={f.templateId}>
                    {f.name}: {f.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button type="button" className="btn btn-sm" onClick={() => setResult(null)}>
            Dismiss
          </button>
        </div>
      )}

      <Loadable resource={list}>
        {(rows) =>
          rows.length === 0 ? (
            <div className="panel">
              <EmptyState title="No recurring journals" body="Create a template for entries you post every week, month, quarter or year." />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Template</th>
                    <th>Repeats</th>
                    <th>Next run</th>
                    <th className="num">Amount ({currency})</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const total = r.lines.reduce((s, l) => s + toNumber(l.debit), 0);
                    const due = r.isActive && r.nextRunDate.slice(0, 10) <= today;
                    return (
                      <tr key={r.id} className={r.isActive ? undefined : "row-inactive"}>
                        <td>
                          {r.name}
                          {r.description && <span className="sub">{r.description}</span>}
                        </td>
                        <td>{humanize(r.frequency)}</td>
                        <td className="nowrap">
                          {calendarDate(r.nextRunDate)}
                          {r.endDate && <span className="sub">Ends {calendarDate(r.endDate)}</span>}
                        </td>
                        <td className="num">{amount(total)}</td>
                        <td>
                          {!r.isActive ? <Badge>Finished</Badge> : due ? <Badge tone="warning">Due</Badge> : <Badge tone="positive">Scheduled</Badge>}
                          <span className="sub">{r.autoPost ? "Posts automatically" : "Creates drafts"}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )
        }
      </Loadable>

      {creating && (
        <RecurringForm
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            list.reload();
          }}
        />
      )}
    </>
  );
}

type DraftLine = { accountId: string; description: string; debit: string; credit: string };
const EMPTY: DraftLine = { accountId: "", description: "", debit: "", credit: "" };

function RecurringForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { can, api } = useSession();
  const accounts = useResource<Account[]>("/api/v1/coa");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [frequency, setFrequency] = useState("MONTHLY");
  const [nextRunDate, setNextRunDate] = useState(isoDay());
  const [autoPost, setAutoPost] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([{ ...EMPTY }, { ...EMPTY }]);
  const { busy, error, setError, run } = useSubmit(onSaved);
  const opts = useMemo(() => accountOptions(accounts.data ?? [], (a) => a.isActive && a.allowManualPost), [accounts.data]);

  const debit = lines.reduce((s, l) => s + (parseAmount(l.debit) || 0), 0);
  const credit = lines.reduce((s, l) => s + (parseAmount(l.credit) || 0), 0);
  const difference = Math.round((debit - credit) * 100) / 100;

  function update(i: number, patch: Partial<DraftLine>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = lines
      .filter((l) => l.accountId || l.debit || l.credit)
      .map((l) => ({ accountId: l.accountId, debit: parseAmount(l.debit) || 0, credit: parseAmount(l.credit) || 0, description: l.description.trim() || undefined }));
    if (!name.trim()) return setError("Give the template a name.");
    if (parsed.length < 2) return setError("A journal needs at least two lines.");
    if (parsed.some((l) => !l.accountId)) return setError("Every line needs an account.");
    if (parsed.some((l) => (l.debit > 0) === (l.credit > 0))) return setError("Each line needs either a debit or a credit.");
    if (difference !== 0) return setError(`Debits and credits differ by ${amount(Math.abs(difference))}.`);
    void run(async () => {
      await api("/api/v1/books/recurring", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), description: description.trim() || undefined, frequency, nextRunDate, autoPost, lines: parsed }),
      });
      return "Recurring journal saved";
    });
  }

  return (
    <Drawer title="New recurring journal" wide onClose={onClose} footer={<Footer onCancel={onClose} busy={busy} label="Save template" formId="recurring-form" />}>
      <FormError message={error} />
      <form id="recurring-form" onSubmit={submit} className="form-grid">
        <Field label="Name" required>
          <input className="input" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Office rent accrual" />
        </Field>
        <Field label="Journal description">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Defaults to the name" />
        </Field>
        <Field label="Repeats" required>
          <Select value={frequency} onChange={setFrequency} options={FREQUENCIES} />
        </Field>
        <Field label="First run date" required>
          <input className="input" type="date" required value={nextRunDate} onChange={(e) => setNextRunDate(e.target.value)} />
        </Field>
        {can("journal:post") && (
          <label className="check span-2">
            <input type="checkbox" checked={autoPost} onChange={(e) => setAutoPost(e.target.checked)} />
            Post each journal automatically instead of leaving it as a draft
          </label>
        )}
        <div className="span-2">
          <table className="table lines-table">
            <thead>
              <tr>
                <th>Account</th>
                <th>Line description</th>
                <th className="num" style={{ width: 140 }}>
                  Debit
                </th>
                <th className="num" style={{ width: 140 }}>
                  Credit
                </th>
                <th style={{ width: 36 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <Select value={l.accountId} onChange={(v) => update(i, { accountId: v })} options={opts} placeholder="Choose an account" aria-label={`Account for line ${i + 1}`} />
                  </td>
                  <td>
                    <input className="input" value={l.description} onChange={(e) => update(i, { description: e.target.value })} aria-label={`Description for line ${i + 1}`} />
                  </td>
                  <td>
                    <MoneyInput value={l.debit} onChange={(v) => update(i, { debit: v, credit: v ? "" : l.credit })} aria-label={`Debit for line ${i + 1}`} />
                  </td>
                  <td>
                    <MoneyInput value={l.credit} onChange={(v) => update(i, { credit: v, debit: v ? "" : l.debit })} aria-label={`Credit for line ${i + 1}`} />
                  </td>
                  <td>
                    {lines.length > 2 && (
                      <button type="button" className="icon-button" aria-label={`Remove line ${i + 1}`} onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                        ×
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Total</td>
                <td className="num">{amount(debit)}</td>
                <td className="num">{amount(credit)}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          <div className="filter-bar" style={{ marginTop: 8 }}>
            <button type="button" className="btn" onClick={() => setLines((ls) => [...ls, { ...EMPTY }])}>
              <Plus size={16} aria-hidden="true" />
              Add line
            </button>
            <span className="grow" />
            <span className={difference === 0 ? "muted small" : "text-negative strong small"}>{difference === 0 ? "Balanced" : `Out of balance by ${amount(Math.abs(difference))}`}</span>
          </div>
        </div>
      </form>
    </Drawer>
  );
}

type ImportResult = {
  batch: { id: string; status: string; rowCount: number; errorCount: number; summaryJson: { errors?: string[]; journalId?: string } | null; createdAt: string };
  journal: { id: string; journalNumber?: string | null; totalDebit?: string | number } | null;
};

const SAMPLE = "accountCode,debit,credit,description\n6100,250000,0,Office rent March\n1110,0,250000,Paid from bank";

export function JournalImport() {
  const { can, api } = useSession();
  const { currency } = useCompany();
  const [csv, setCsv] = useState("");
  const [journalDate, setJournalDate] = useState(isoDay());
  const [result, setResult] = useState<ImportResult | null>(null);
  const { busy, error, setError, run } = useSubmit();

  const preview = useMemo(() => {
    const rows = csv
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.toLowerCase().startsWith("account"))
      .map((l) => l.split(",").map((p) => p.trim()));
    const debit = rows.reduce((s, r) => s + (Number(r[1]) || 0), 0);
    const credit = rows.reduce((s, r) => s + (Number(r[2]) || 0), 0);
    return { rows, debit, credit };
  }, [csv]);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setCsv(await file.text());
    e.target.value = "";
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!preview.rows.length) return setError("Paste or upload at least two lines.");
    void run(async () => {
      const res = await api<ImportResult>("/api/v1/books/import/journal", { method: "POST", body: JSON.stringify({ csv, journalDate }) });
      setResult(res);
      if (res.journal) setCsv("");
      return res.journal ? "Journal imported as a draft" : "Import failed. See the errors below";
    });
  }

  const errors = result?.batch.summaryJson?.errors ?? [];

  return (
    <>
      <PageHeader title="Import a journal" description="Create one draft journal from a CSV file. Review and post it from Journal entries." />

      {result && (
        <div className={`notice ${result.journal ? "info" : "error"}`} role="status" style={{ marginBottom: 16 }}>
          <div className="grow">
            {result.journal ? (
              <>
                <strong>Imported {plural(result.batch.rowCount, "line")}</strong>
                {result.journal.journalNumber && ` as ${result.journal.journalNumber}`}. The journal is a draft until it's posted. <Link to="/journals">Open journal entries</Link>
              </>
            ) : (
              <>
                <strong>Nothing was imported. {plural(result.batch.errorCount, "problem")} to fix:</strong>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {errors.map((m) => (
                    <li key={m}>{m}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <button type="button" className="btn btn-sm" onClick={() => setResult(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="panel panel-body">
        <FormError message={error} />
        <form onSubmit={submit} className="form-grid">
          <Field label="Journal date" required>
            <input className="input" type="date" required value={journalDate} onChange={(e) => setJournalDate(e.target.value)} />
          </Field>
          <Field label="CSV file" hint="Or paste the lines below.">
            <label className="btn" style={{ width: "fit-content" }}>
              <Upload size={16} aria-hidden="true" />
              Choose file
              <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void onFile(e)} style={{ display: "none" }} />
            </label>
          </Field>
          <Field
            label="Lines"
            required
            className="span-2"
            hint={
              <>
                One line per row: <span className="mono">accountCode,debit,credit,description</span>. A header row starting with "account" is skipped. Use plain numbers without thousands separators.
              </>
            }
          >
            <textarea className="input mono" rows={10} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={SAMPLE} spellCheck={false} />
          </Field>
          <div className="span-2 filter-bar" style={{ marginBottom: 0 }}>
            <span className="muted small grow">
              {preview.rows.length ? `${plural(preview.rows.length, "line")} · debits ${currency} ${amount(preview.debit)} · credits ${currency} ${amount(preview.credit)}` : "No lines yet"}
              {preview.rows.length > 0 && Math.abs(preview.debit - preview.credit) > 0.005 && <span className="text-negative strong"> · not balanced</span>}
            </span>
            <button type="button" className="btn" onClick={() => setCsv(SAMPLE)}>
              Use example
            </button>
            {can("journal:create") && (
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? "Importing…" : "Import journal"}
              </button>
            )}
          </div>
        </form>
      </div>
    </>
  );
}
