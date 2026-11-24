import { Pencil } from "lucide-react";
import { type ReactNode, useState } from "react";
import { type Prefs, usePreferences } from "../../lib/preferences";
import { Link } from "../../lib/router";
import { useFeedback } from "../feedback";
import { SettingsToggle } from "./SettingsToggle";

export type SettingRow = { key: string; label: string; hint?: string; badge?: string } & (
  | { kind: "toggle"; value: boolean }
  | { kind: "select"; value: string; options: string[] }
  | { kind: "text" | "longtext" | "email"; value: string; empty?: string }
  | { kind: "link"; value: string; to: string }
);

type Save = (values: Prefs) => Promise<void>;

/**
 * A settings card in the QuickBooks pattern: it shows values, Edit turns them into fields, then Save or Cancel.
 * Toggles also save on their own when the card isn't being edited.
 */
export function SettingsCard({
  title,
  description,
  rows,
  values,
  canEdit,
  onSave,
  children,
}: {
  title: string;
  description?: string;
  rows: SettingRow[];
  values: Prefs;
  canEdit: boolean;
  onSave: Save;
  children?: ReactNode;
}) {
  const { toast } = useFeedback();
  const [draft, setDraft] = useState<Prefs | null>(null);
  const [busy, setBusy] = useState(false);
  const shown = draft ?? values;

  async function commit(next: Prefs, done: string) {
    setBusy(true);
    try {
      await onSave(next);
      setDraft(null);
      toast(done);
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (!draft) return;
    const bad = rows.find((r) => r.kind === "email" && draft[r.key] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(draft[r.key])));
    if (bad) return toast(`Enter a valid ${bad.label.toLowerCase()}`, { error: true });
    void commit(draft, `${title} saved`);
  }

  function control(row: SettingRow) {
    if (row.kind === "toggle") {
      const set = (on: boolean) => {
        if (!canEdit || busy) return;
        if (draft) setDraft({ ...draft, [row.key]: on });
        else void commit({ ...values, [row.key]: on }, `${row.label}: ${on ? "on" : "off"}`);
      };
      return <SettingsToggle label={row.label} on={Boolean(shown[row.key])} onChange={set} disabled={!canEdit || busy} />;
    }
    if (row.kind === "link") return <Link to={row.to} className="ee-link-btn">{row.value}</Link>;
    const text = String(shown[row.key] ?? "");
    if (!draft) return <strong className="ee-settings-val">{text || ("empty" in row && row.empty) || "Not set"}</strong>;
    const set = (v: string) => setDraft({ ...draft, [row.key]: v });
    if (row.kind === "select")
      return (
        <select className="ee-input-select ee-settings-field" aria-label={row.label} value={text} onChange={(e) => set(e.target.value)}>
          {(row.options.includes(text) ? row.options : [text, ...row.options]).map((o) => (
            <option key={o} value={o}>{o || "Not set"}</option>
          ))}
        </select>
      );
    if (row.kind === "longtext") return <textarea className="ee-input-text ee-settings-field wide" aria-label={row.label} rows={4} maxLength={1000} value={text} onChange={(e) => set(e.target.value)} />;
    return <input className="ee-input-text ee-settings-field" aria-label={row.label} type={row.kind === "email" ? "email" : "text"} maxLength={200} value={text} onChange={(e) => set(e.target.value)} />;
  }

  return (
    <section className="ee-settings-card">
      <header className="ee-settings-card-head ee-settings-card-head-row">
        <div>
          <h2>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {canEdit && !draft && rows.some((r) => r.kind !== "link") ? (
          <button type="button" className="ee-link-btn" aria-label={`Edit ${title}`} onClick={() => setDraft({ ...values })}>
            <Pencil size={14} strokeWidth={1.5} aria-hidden="true" /> Edit
          </button>
        ) : null}
      </header>
      {rows.map((row) => (
        <div className={`ee-settings-row ${draft && row.kind === "longtext" ? "ee-settings-row-stack" : ""}`} key={row.key}>
          <div>
            <div className="ee-settings-row-label">
              {row.label}
              {row.badge ? <span className="ee-settings-new">{row.badge}</span> : null}
            </div>
            {row.hint ? <div className="ee-settings-hint">{row.hint}</div> : null}
          </div>
          {control(row)}
        </div>
      ))}
      {children}
      {draft ? (
        <div className="ee-settings-edit-actions">
          <button type="button" className="btn ee-btn-outline-blue btn-sm" disabled={busy} onClick={() => setDraft(null)}>Cancel</button>
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        </div>
      ) : null}
    </section>
  );
}

const defaultsOf = (rows: SettingRow[]): Prefs => Object.fromEntries(rows.filter((r) => r.kind !== "link").map((r) => [r.key, r.value]));

/** A card whose values are company preferences stored under `id`. */
export function SettingsSection({ id, ...card }: { id: string; title: string; description?: string; rows: SettingRow[]; children?: ReactNode }) {
  const prefs = usePreferences(id, defaultsOf(card.rows));
  return (
    <>
      <SettingsCard {...card} values={prefs.values} canEdit={prefs.canEdit} onSave={prefs.save} />
      {prefs.error ? <p className="ee-settings-hint" role="alert">Couldn't load {card.title.toLowerCase()}: {prefs.error}</p> : null}
    </>
  );
}
