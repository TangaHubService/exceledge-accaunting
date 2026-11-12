import { Check, Download, FileUp } from "lucide-react";
import { type ChangeEvent, useMemo, useState } from "react";
import { useFeedback } from "../components/feedback";
import { Select } from "../components/Select";
import { applyMapping, autoMap, IMPORT_FIELDS, type ImportMapping, type ImportRow, parseCsv, toRows } from "../lib/coa-import";
import { useCoaSettings } from "../lib/coa-settings";
import { navigate } from "../lib/router";
import { useResource, useSession } from "../lib/session";
import type { Account } from "../lib/types";

type Step = 1 | 2 | 3;
type Result = { createdCount: number; errors: Array<{ code: string; error: string }> };

const STEPS: Array<{ n: Step; label: string }> = [
  { n: 1, label: "Upload" },
  { n: 2, label: "Map data" },
  { n: 3, label: "Import" },
];

/**
 * QuickBooks-style chart of accounts import, reached from Import data: 1 Upload a file, 2 Map its columns to account
 * fields, 3 Review and import. Uses the same rules as the chart itself.
 */
export function ImportChartOfAccounts() {
  const { api, download } = useSession();
  const { toast } = useFeedback();
  const { useAccountNumbers: numbersOn } = useCoaSettings();
  const accounts = useResource<Account[]>("/api/v1/coa");
  const [step, setStep] = useState<Step>(1);
  const [fileName, setFileName] = useState("");
  const [table, setTable] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ImportMapping>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);

  // With account numbers off (QuickBooks setting) the number fields are not offered.
  const fields = IMPORT_FIELDS.filter((f) => numbersOn || (f.key !== "code" && f.key !== "parentCode"));
  const headers = table[0] ?? [];
  const missingRequired = fields.filter((f) => f.required && mapping[f.key] === undefined);

  const rows: ImportRow[] = useMemo(() => {
    if (step !== 3 || !table.length) return [];
    const effective = numbersOn ? mapping : { ...mapping, code: undefined, parentCode: undefined };
    return toRows(applyMapping(table, effective), accounts.data ?? []).rows;
  }, [step, table, mapping, accounts.data, numbersOn]);
  const ready = rows.filter((r) => !r.problem);

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    try {
      const parsed = parseCsv(await file.text());
      if (parsed.length < 2) throw new Error("The file has no account rows under its header row");
      setFileName(file.name);
      setTable(parsed);
      setMapping(autoMap(parsed[0]));
    } catch (err) {
      setFileName("");
      setTable([]);
      setError((err as Error).message);
    }
  }

  async function sample() {
    try {
      await download("/api/v1/coa/export?format=csv", "chart-of-accounts-sample.csv");
    } catch (err) {
      toast((err as Error).message, { error: true });
    }
  }

  async function runImport() {
    setBusy(true);
    setError("");
    try {
      const res = await api<Result>("/api/v1/coa/import", {
        method: "POST",
        body: JSON.stringify({
          rows: ready.map((r) => ({
            code: r.code,
            name: r.name,
            type: r.type,
            parentCode: r.parentCode,
            ...(r.parentName ? { parentName: r.parentName } : {}),
            description: r.description,
            reportingGroup: r.reportingGroup,
          })),
        }),
      });
      setResult(res);
      if (res.createdCount) toast(`Imported ${res.createdCount} account${res.createdCount === 1 ? "" : "s"}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function restart() {
    setStep(1);
    setFileName("");
    setTable([]);
    setMapping({});
    setResult(null);
    setError("");
  }

  const columnOptions = [{ value: "", label: "No column (leave blank)" }, ...headers.map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` }))];

  return (
    <div className="ee-tools-page ee-imp-page">
      <nav className="ee-cust-crumbs" aria-label="Breadcrumb">
        <button type="button" className="ee-link-btn" onClick={() => navigate("/import-data")}>
          Import data
        </button>
        <span className="ee-cust-crumbs-sep">/</span>
        <span>Chart of accounts</span>
      </nav>
      <header className="ee-import-header">
        <div>
          <h1 className="ee-import-title">Import accounts</h1>
          <p className="ee-import-subtitle">Bring your chart of accounts in from a CSV file. QuickBooks Account List exports work too.</p>
        </div>
      </header>

      <ol className="ee-imp-steps" aria-label="Import steps">
        {STEPS.map((s) => (
          <li key={s.n} className={s.n === step ? "on" : s.n < step ? "done" : ""} aria-current={s.n === step ? "step" : undefined}>
            <span className="ee-imp-step-dot">{s.n < step ? <Check size={14} strokeWidth={2.5} aria-hidden="true" /> : s.n}</span>
            {s.label}
          </li>
        ))}
      </ol>

      <section className="ee-imp-card">
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}

        {step === 1 && (
          <>
            <h2 className="ee-imp-h2">Upload your file</h2>
            <label className="ee-coa-drop">
              <FileUp size={22} strokeWidth={1.5} aria-hidden="true" />
              <span>{fileName ? <strong>{fileName}</strong> : "Browse for a CSV file"}</span>
              <span className="subtle">Needs account name and type. Account number, detail type and description are optional.</span>
              <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e)} />
            </label>
            <button type="button" className="ee-coa-tool" onClick={() => void sample()}>
              <Download size={14} strokeWidth={1.75} aria-hidden="true" /> Download a sample file (your current chart)
            </button>
          </>
        )}

        {step === 2 && (
          <>
            <h2 className="ee-imp-h2">Map your fields to accounts</h2>
            <p className="subtle">Pick the column in {fileName} that holds each field. We matched the ones we recognised.</p>
            <table className="ee-coa-table ee-imp-map">
              <thead>
                <tr>
                  <th>Account field</th>
                  <th>Your field</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => (
                  <tr key={f.key}>
                    <td>
                      {f.label}
                      {f.required && <span className="ee-imp-req"> *</span>}
                      {"hint" in f && <div className="subtle ee-imp-hint">{f.hint}</div>}
                    </td>
                    <td>
                      <Select
                        value={mapping[f.key] === undefined ? "" : String(mapping[f.key])}
                        onChange={(v) => setMapping((m) => ({ ...m, [f.key]: v === "" ? undefined : Number(v) }))}
                        options={columnOptions}
                        aria-label={`Column for ${f.label}`}
                        invalid={f.required && mapping[f.key] === undefined}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {missingRequired.length > 0 && <p className="field-error">Map {missingRequired.map((f) => f.label).join(" and ")} to continue.</p>}
          </>
        )}

        {step === 3 && !result && (
          <>
            <h2 className="ee-imp-h2">Review and import</h2>
            <p className="subtle">
              {ready.length} of {rows.length} accounts ready
              {rows.length - ready.length > 0 && ` · ${rows.length - ready.length} will be skipped`}
            </p>
            <div className="ee-coa-table-wrap">
              <table className="ee-coa-table ee-coa-import-table">
                <thead>
                  <tr>
                    <th>Line</th>
                    {numbersOn && <th>Number</th>}
                    <th>Name</th>
                    <th>Type</th>
                    <th>Parent</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.line} className={r.problem ? "inactive" : ""}>
                      <td className="subtle">{r.line}</td>
                      {numbersOn && <td className="mono">{r.code || <span className="subtle">Auto</span>}</td>}
                      <td>{r.name}</td>
                      <td>{r.type}</td>
                      <td>{r.parentCode || r.parentName || "—"}</td>
                      <td>{r.problem ? <span className="ee-coa-import-bad">{r.problem}</span> : <span className="ee-coa-import-ok">Ready</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {step === 3 && result && (
          <div className="ee-imp-done">
            <span className="ee-imp-done-icon">
              <Check size={28} strokeWidth={2.5} aria-hidden="true" />
            </span>
            <h2 className="ee-imp-h2">
              {result.createdCount} account{result.createdCount === 1 ? "" : "s"} imported
            </h2>
            {result.errors.length > 0 && (
              <ul className="ee-coa-import-errors">
                {result.errors.map((er) => (
                  <li key={er.code}>
                    <span className="mono">{er.code}</span>: {er.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <footer className="ee-imp-foot">
        {result ? (
          <>
            <button type="button" className="btn ee-btn-outline-blue" onClick={restart}>
              Import another file
            </button>
            <button type="button" className="btn btn-primary" onClick={() => navigate("/accounting/chart-of-accounts")}>
              View chart of accounts
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn ee-btn-outline-blue" onClick={() => (step === 1 ? navigate("/import-data") : setStep((s) => (s - 1) as Step))}>
              {step === 1 ? "Cancel" : "Back"}
            </button>
            {step < 3 ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={(step === 1 && !table.length) || (step === 2 && missingRequired.length > 0)}
                onClick={() => setStep((s) => (s + 1) as Step)}
              >
                Next
              </button>
            ) : (
              <button type="button" className="btn btn-primary" disabled={busy || ready.length === 0 || accounts.loading} onClick={() => void runImport()}>
                {busy ? "Importing…" : `Import ${ready.length || ""} account${ready.length === 1 ? "" : "s"}`}
              </button>
            )}
          </>
        )}
      </footer>
    </div>
  );
}
