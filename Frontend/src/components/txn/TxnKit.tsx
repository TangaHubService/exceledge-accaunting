import {
  ChevronDown,
  ChevronUp,
  Copy,
  GripVertical,
  HelpCircle,
  History,
  MessageSquareText,
  Paperclip,
  Settings,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { type DragEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useCompany } from "../../lib/company";
import { amount, date } from "../../lib/format";
import { navigate } from "../../lib/router";
import { type RecurringTemplate, saveRecurring, TXN_LABELS, type TxnKind, useTxnIndex } from "../../lib/txn";
import { type FieldErrors, validateYup, yup } from "../../lib/validation";
import { useFeedback } from "../feedback";
import { parseAmount } from "../forms";
import { Select, type SelectOption } from "../Select";

/* ── Validation ────────────────────────────────────────── */

/** Validate on submit, then live-clear errors as fields change. */
export function useValidation() {
  const [errors, setErrors] = useState<FieldErrors>({});
  async function validate(schema: yup.AnyObjectSchema, values: unknown) {
    const result = await validateYup(schema, values);
    setErrors(result.ok ? {} : result.errors);
    return result.ok;
  }
  /** Drop the error on `path` and on anything nested under it (e.g. `lines[2].amount`). */
  function clear(path: string) {
    setErrors((e) => {
      const keys = Object.keys(e).filter((k) => k === path || k.startsWith(`${path}[`) || k.startsWith(`${path}.`));
      if (!keys.length) return e;
      const next = { ...e };
      for (const k of keys) delete next[k];
      return next;
    });
  }
  const count = Object.keys(errors).length;
  return { errors, setErrors, validate, clear, count };
}

/** A grid row counts once anything is typed into it. */
export function isBlankRow(row: Record<string, unknown>, keys: string[]) {
  return keys.every((k) => {
    const v = row[k];
    return v === undefined || v === null || String(v).trim() === "";
  });
}

export const money = () =>
  yup
    .string()
    .test("money", "Enter a valid amount", (v) => !v || Number.isFinite(parseAmount(v)))
    .test("positive", "Amount can't be negative", (v) => !v || parseAmount(v) >= 0);

/* ── Page chrome ───────────────────────────────────────── */

export type TopAction = "copy" | "feedback" | "settings" | "help" | "autofill" | "close";

export function TxnPage({
  title,
  kind,
  brand = true,
  onClose,
  actions = ["feedback", "settings", "help", "close"],
  feedbackLabel = "Feedback",
  onCopy,
  onSettings,
  onAutofill,
  autofillOn,
  tabs,
  tab,
  onTab,
  tabActions,
  banner,
  left,
  right,
  footer,
  children,
}: {
  title: ReactNode;
  kind?: TxnKind;
  brand?: boolean;
  onClose: () => void;
  actions?: TopAction[];
  feedbackLabel?: string;
  onCopy?: () => void;
  onSettings?: () => void;
  onAutofill?: () => void;
  autofillOn?: boolean;
  tabs?: string[];
  tab?: string;
  onTab?: (t: string) => void;
  tabActions?: ReactNode;
  banner?: ReactNode;
  left?: ReactNode;
  right?: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  const [feedback, setFeedback] = useState(false);
  const [help, setHelp] = useState(false);
  const [history, setHistory] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !document.querySelector(".txn-modal")) onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="txn-page">
      {brand && (
        <div className="txn-brand">
          <img src="/logo.jpeg" alt="" width={34} height={34} />
          <span className="txn-brand-sep" />
          <span>Excel Edge ERP</span>
        </div>
      )}
      <header className="txn-head">
        <div className="txn-head-title">
          {kind ? (
            <button type="button" className="txn-icon" aria-label="Recent transactions" title="Recent transactions" onClick={() => setHistory((v) => !v)}>
              <History size={22} />
            </button>
          ) : null}
          <h1>{title}</h1>
          {history && kind ? <RecentPopover kind={kind} onClose={() => setHistory(false)} /> : null}
        </div>
        <div className="txn-head-actions">
          {actions.map((a, i) => {
            const sep = i > 0 && (a === "settings" || a === "help" || a === "close" || a === "autofill") ? <span className="txn-sep" /> : null;
            switch (a) {
              case "copy":
                return (
                  <span key={a} className="txn-head-group">
                    <button type="button" className="txn-link-btn" onClick={onCopy}>
                      <Copy size={18} /> Copy
                    </button>
                  </span>
                );
              case "feedback":
                return (
                  <span key={a} className="txn-head-group">
                    <button type="button" className="txn-link-btn" onClick={() => setFeedback(true)}>
                      <MessageSquareText size={18} /> {feedbackLabel}
                    </button>
                  </span>
                );
              case "settings":
                return (
                  <span key={a} className="txn-head-group">
                    {sep}
                    <button type="button" className="txn-icon" aria-label="Settings" title="Settings" onClick={onSettings ?? (() => navigate("/settings/sales"))}>
                      <Settings size={21} />
                    </button>
                  </span>
                );
              case "help":
                return (
                  <span key={a} className="txn-head-group">
                    {sep}
                    <button type="button" className="txn-icon" aria-label="Help" title="Help" onClick={() => setHelp((v) => !v)}>
                      <HelpCircle size={21} />
                    </button>
                  </span>
                );
              case "autofill":
                return (
                  <span key={a} className="txn-head-group">
                    {sep}
                    <button type="button" className={`txn-icon txn-icon-box ${autofillOn ? "on" : ""}`} aria-label="Autofill" title="Autofill" aria-pressed={autofillOn} onClick={onAutofill}>
                      <Sparkles size={19} />
                    </button>
                  </span>
                );
              case "close":
                return (
                  <span key={a} className="txn-head-group">
                    {sep}
                    <button type="button" className="txn-icon" aria-label="Close" title="Close (Esc)" onClick={onClose}>
                      <X size={22} />
                    </button>
                  </span>
                );
            }
          })}
        </div>
        {help ? <HelpPopover onClose={() => setHelp(false)} /> : null}
      </header>
      {tabs ? (
        <nav className="txn-tabs">
          <div className="txn-tab-list" role="tablist">
            {tabs.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "active" : ""} onClick={() => onTab?.(t)}>
                {t}
              </button>
            ))}
          </div>
          <div className="txn-tab-actions">{tabActions}</div>
        </nav>
      ) : null}
      <div className="txn-main">
        {left}
        <div className="txn-scroll">
          {banner}
          {children}
        </div>
        {right}
      </div>
      <footer className="txn-foot">{footer}</footer>
      {feedback ? <FeedbackModal onClose={() => setFeedback(false)} /> : null}
    </div>
  );
}

function RecentPopover({ kind, onClose }: { kind: TxnKind; onClose: () => void }) {
  const rows = useTxnIndex().filter((r) => r.kind === kind).slice(0, 8);
  return (
    <div className="txn-popover txn-recent" role="dialog" aria-label="Recent transactions">
      <div className="txn-popover-head">
        <strong>Recent {TXN_LABELS[kind].toLowerCase()}s</strong>
        <button type="button" className="txn-icon sm" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="muted">Nothing saved yet.</p>
      ) : (
        <ul>
          {rows.map((r) => (
            <li key={r.id}>
              <span>
                <strong>{r.number ? `#${r.number}` : TXN_LABELS[r.kind]}</strong> · {r.party || "—"}
              </span>
              <span className="num">
                {date(r.date)} · {amount(r.amount, 2)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HelpPopover({ onClose }: { onClose: () => void }) {
  return (
    <div className="txn-popover txn-help" role="dialog" aria-label="Help">
      <div className="txn-popover-head">
        <strong>Help</strong>
        <button type="button" className="txn-icon sm" onClick={onClose} aria-label="Close">
          <X size={16} />
        </button>
      </div>
      <ul className="txn-help-list">
        <li>Fields marked with an asterisk are required.</li>
        <li>Blank lines are ignored when you save.</li>
        <li>Drag the handle on a line to reorder it.</li>
        <li>Press Esc to close without saving.</li>
      </ul>
    </div>
  );
}

/* ── Header band ───────────────────────────────────────── */

export function HeaderBand({
  children,
  amountLabel,
  amountValue,
  aside,
  collapsible = true,
  summary,
}: {
  children: ReactNode;
  amountLabel?: string;
  amountValue?: string;
  aside?: ReactNode;
  collapsible?: boolean;
  summary?: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <section className={`txn-band ${open ? "" : "collapsed"}`}>
      <div className="txn-band-body">
        <div className="txn-band-fields">{open ? children : <div className="txn-band-summary">{summary}</div>}</div>
        {amountLabel || aside ? (
          <div className="txn-band-amount">
            {amountLabel ? <span className="txn-amount-label">{amountLabel}</span> : null}
            {amountValue ? <strong className="txn-amount">{amountValue}</strong> : null}
            {aside}
          </div>
        ) : null}
      </div>
      {collapsible ? (
        <button type="button" className="txn-band-toggle" onClick={() => setOpen((v) => !v)} aria-label={open ? "Collapse" : "Expand"} aria-expanded={open}>
          {open ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
        </button>
      ) : null}
    </section>
  );
}

/** Big amount at the end of a band row, for bands whose lower rows need the full width. */
export function BandAmount({ label, value }: { label: string; value: string }) {
  return (
    <div className="txn-band-amount" style={{ marginLeft: "auto" }}>
      <span className="txn-amount-label">{label}</span>
      <strong className="txn-amount">{value}</strong>
    </div>
  );
}

export function TField({
  label,
  required,
  error,
  hint,
  className,
  children,
  aside,
}: {
  label: ReactNode;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <label className={`txn-field ${error ? "has-error" : ""} ${className ?? ""}`}>
      <span className="txn-label">
        <span>
          {label}
          {required ? <span className="req">*</span> : null}
        </span>
        {aside}
      </span>
      {children}
      {error ? (
        <span className="field-error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </label>
  );
}

/* ── Buttons ───────────────────────────────────────────── */

export type SplitItem = { label: string; onSelect: () => void; disabled?: boolean };

export function SplitButton({
  label,
  onClick,
  items,
  variant = "primary",
  disabled,
  busy,
}: {
  label: string;
  onClick: () => void;
  items?: SplitItem[];
  variant?: "primary" | "secondary";
  disabled?: boolean;
  busy?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return (
    <div className={`txn-split ${variant}`} ref={ref}>
      <button type="button" className="txn-split-main" onClick={onClick} disabled={disabled || busy}>
        {busy ? "Saving…" : label}
      </button>
      {items?.length ? (
        <>
          <button type="button" className="txn-split-caret" aria-label={`More ${label} options`} aria-expanded={open} onClick={() => setOpen((v) => !v)} disabled={disabled || busy}>
            <ChevronDown size={18} />
          </button>
          {open ? (
            <div className="txn-split-menu" role="menu">
              {items.map((it) => (
                <button
                  key={it.label}
                  type="button"
                  role="menuitem"
                  disabled={it.disabled}
                  onClick={() => {
                    setOpen(false);
                    it.onSelect();
                  }}
                >
                  {it.label}
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function TxnFooter({ left, center, right }: { left?: ReactNode; center?: ReactNode; right?: ReactNode }) {
  return (
    <>
      <div className="txn-foot-left">{left}</div>
      <div className="txn-foot-center">{center}</div>
      <div className="txn-foot-right">{right}</div>
    </>
  );
}

export function CancelButton({ onClick, tone = "green" }: { onClick: () => void; tone?: "green" | "blue" }) {
  return (
    <button type="button" className={`txn-btn-outline ${tone}`} onClick={onClick}>
      Cancel
    </button>
  );
}

/* ── Party pickers ─────────────────────────────────────── */

export function PartySelect({
  value,
  onChange,
  options,
  placeholder,
  invalid,
  addLabel,
  onAdd,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  placeholder: string;
  invalid?: boolean;
  addLabel?: string;
  onAdd?: () => void;
  ariaLabel?: string;
}) {
  const withAdd = useMemo<SelectOption[]>(() => (onAdd ? [{ value: "__add__", label: `+ ${addLabel ?? "Add new"}` }, ...options] : options), [onAdd, addLabel, options]);
  return (
    <Select
      value={value}
      onChange={(v) => (v === "__add__" ? onAdd?.() : onChange(v))}
      options={withAdd}
      placeholder={placeholder}
      searchable
      invalid={invalid}
      aria-label={ariaLabel ?? placeholder}
      emptyText="No matches"
    />
  );
}

/* ── Line grid ─────────────────────────────────────────── */

export type GridColumn<R> = {
  key: keyof R & string;
  label: string;
  width?: string;
  align?: "right";
  kind?: "text" | "money" | "number" | "date" | "select" | "readonly";
  options?: SelectOption[];
  placeholder?: string;
  /** Called instead of the default setter, e.g. to derive other cells. */
  onSet?: (row: R, value: string) => R;
  render?: (row: R, index: number) => ReactNode;
};

export function LineGrid<R extends Record<string, string>>({
  columns,
  rows,
  onChange,
  newRow,
  errors,
  errorPrefix = "lines",
  copy = true,
  remove = true,
  addLabel = "Add lines",
  showAdd = true,
  showClear = true,
  footerRow,
  toolbar,
  extraButtons,
  minRows = 1,
}: {
  columns: GridColumn<R>[];
  rows: R[];
  onChange: (rows: R[]) => void;
  newRow: () => R;
  errors?: FieldErrors;
  errorPrefix?: string;
  copy?: boolean;
  remove?: boolean;
  addLabel?: string;
  showAdd?: boolean;
  showClear?: boolean;
  footerRow?: ReactNode;
  toolbar?: ReactNode;
  extraButtons?: ReactNode;
  minRows?: number;
}) {
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const { confirm } = useFeedback();

  function set(i: number, col: GridColumn<R>, value: string) {
    onChange(rows.map((r, j) => (j === i ? (col.onSet ? col.onSet(r, value) : { ...r, [col.key]: value }) : r)));
  }
  function drop(e: DragEvent, to: number) {
    e.preventDefault();
    if (dragFrom === null || dragFrom === to) return;
    const next = [...rows];
    const [moved] = next.splice(dragFrom, 1);
    next.splice(to, 0, moved);
    onChange(next);
    setDragFrom(null);
  }
  async function clearAll() {
    if (!(await confirm({ title: "Clear all lines?", body: "Every line on this form will be emptied.", confirmLabel: "Clear lines", danger: true }))) return;
    onChange(Array.from({ length: Math.max(minRows, 2) }, newRow));
  }
  const rowErrors = (i: number) => Object.entries(errors ?? {}).filter(([k]) => k.startsWith(`${errorPrefix}[${i}]`));
  const tableError = errors?.[errorPrefix];

  return (
    <div className="txn-grid-wrap">
      {toolbar ? <div className="txn-grid-toolbar">{toolbar}</div> : null}
      <div className="txn-grid-scroll">
        <table className="txn-grid">
          <thead>
            <tr>
              <th className="txn-grid-handle" aria-label="Reorder" />
              <th className="txn-grid-num">#</th>
              {columns.map((c) => (
                <th key={c.key} style={{ width: c.width }} className={c.align === "right" ? "right" : ""}>
                  {c.label}
                </th>
              ))}
              {copy ? <th className="txn-grid-act" aria-label="Copy" /> : null}
              {remove ? <th className="txn-grid-act" aria-label="Delete" /> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const errs = rowErrors(i);
              return (
                <tr
                  key={i}
                  className={`${errs.length ? "has-error" : ""} ${dragFrom === i ? "dragging" : ""}`}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => drop(e, i)}
                >
                  <td className="txn-grid-handle" draggable onDragStart={() => setDragFrom(i)} onDragEnd={() => setDragFrom(null)} title="Drag to reorder">
                    <GripVertical size={16} />
                  </td>
                  <td className="txn-grid-num">{i + 1}</td>
                  {columns.map((c) => {
                    const err = errors?.[`${errorPrefix}[${i}].${c.key}`];
                    return (
                      <td key={c.key} className={`${c.align === "right" ? "right" : ""} ${err ? "invalid" : ""}`} title={err}>
                        {c.render ? (
                          c.render(row, i)
                        ) : c.kind === "readonly" ? (
                          <span className="txn-cell-static">{row[c.key]}</span>
                        ) : c.kind === "select" ? (
                          <Select
                            className="txn-cell-select"
                            value={row[c.key]}
                            onChange={(v) => set(i, c, v)}
                            options={c.options ?? []}
                            placeholder={c.placeholder ?? ""}
                            searchable
                            invalid={Boolean(err)}
                            aria-label={`${c.label} line ${i + 1}`}
                          />
                        ) : (
                          <input
                            className="txn-cell"
                            type={c.kind === "date" ? "date" : "text"}
                            inputMode={c.kind === "money" || c.kind === "number" ? "decimal" : undefined}
                            value={row[c.key]}
                            placeholder={c.placeholder}
                            aria-label={`${c.label} line ${i + 1}`}
                            aria-invalid={Boolean(err)}
                            onChange={(e) => set(i, c, c.kind === "money" || c.kind === "number" ? e.target.value.replace(/[^\d.,-]/g, "") : e.target.value)}
                            onBlur={(e) => {
                              if (c.kind !== "money") return;
                              const n = parseAmount(e.target.value);
                              if (Number.isFinite(n)) set(i, c, amount(n, 2));
                            }}
                          />
                        )}
                      </td>
                    );
                  })}
                  {copy ? (
                    <td className="txn-grid-act">
                      <button type="button" className="txn-icon sm" aria-label={`Duplicate line ${i + 1}`} title="Duplicate line" onClick={() => onChange([...rows.slice(0, i + 1), { ...row }, ...rows.slice(i + 1)])}>
                        <Copy size={17} />
                      </button>
                    </td>
                  ) : null}
                  {remove ? (
                    <td className="txn-grid-act">
                      <button
                        type="button"
                        className="txn-icon sm"
                        aria-label={`Delete line ${i + 1}`}
                        title="Delete line"
                        onClick={() => onChange(rows.length > minRows ? rows.filter((_, j) => j !== i) : rows.map((r, j) => (j === i ? newRow() : r)))}
                      >
                        <Trash2 size={17} />
                      </button>
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
          {footerRow ? <tfoot>{footerRow}</tfoot> : null}
        </table>
      </div>
      {tableError ? (
        <p className="field-error txn-grid-error" role="alert">
          {tableError}
        </p>
      ) : null}
      {showAdd || showClear || extraButtons ? (
        <div className="txn-grid-buttons">
          {extraButtons}
          {showAdd ? (
            <button type="button" className="txn-btn-outline sm" onClick={() => onChange([...rows, newRow(), newRow()])}>
              {addLabel}
            </button>
          ) : null}
          {showClear ? (
            <button type="button" className="txn-btn-outline sm" onClick={clearAll}>
              Clear all lines
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Small icon cluster above a grid (edit columns / paste lines / settings). */
export function GridTools({ onSettings, onPaste }: { onSettings?: () => void; onPaste?: () => void }) {
  const { toast } = useFeedback();
  return (
    <div className="txn-grid-tools">
      <button type="button" className="txn-icon sm" aria-label="Paste lines from clipboard" title="Paste lines from clipboard" onClick={onPaste ?? (() => toast("Copy rows from a spreadsheet, then use Paste lines."))}>
        <Copy size={19} />
      </button>
      {onSettings ? (
        <button type="button" className="txn-icon sm" aria-label="Table settings" title="Table settings" onClick={onSettings}>
          <Settings size={19} />
        </button>
      ) : null}
    </div>
  );
}

/** Read tab-separated rows from the clipboard (pasted from a spreadsheet). */
export async function readClipboardRows(): Promise<string[][]> {
  const text = await navigator.clipboard.readText();
  return text
    .split(/\r?\n/)
    .map((l) => l.split("\t"))
    .filter((cells) => cells.some((c) => c.trim()));
}

/* ── Totals ────────────────────────────────────────────── */

export function Totals({ rows }: { rows: Array<{ label: ReactNode; value: ReactNode; strong?: boolean; rule?: boolean; big?: boolean }> }) {
  return (
    <dl className="txn-totals">
      {rows.map((r, i) => (
        <div key={i} className={`${r.strong ? "strong" : ""} ${r.rule ? "rule" : ""} ${r.big ? "big" : ""}`}>
          <dt>{r.label}</dt>
          <dd className="num">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ── Memo & attachments ────────────────────────────────── */

export function TextArea({
  label,
  value,
  onChange,
  placeholder,
  error,
  maxLength = 1000,
  rows = 3,
  className,
}: {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  error?: string;
  maxLength?: number;
  rows?: number;
  className?: string;
}) {
  return (
    <TField label={label} error={error} className={className}>
      <textarea className="txn-textarea" rows={rows} value={value} placeholder={placeholder} maxLength={maxLength} onChange={(e) => onChange(e.target.value)} />
    </TField>
  );
}

export type PickedFile = { id: string; file: File };

const ATTACH_ACCEPT = ".pdf,.png,.jpg,.jpeg,.heic,.webp,.csv,.xlsx,.xls,.docx,.txt";

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentBox({
  files,
  onChange,
  maxMb = 20,
  showExisting = true,
  dashed = true,
  className,
}: {
  files: PickedFile[];
  onChange: (files: PickedFile[]) => void;
  maxMb?: number;
  showExisting?: boolean;
  dashed?: boolean;
  className?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const { toast } = useFeedback();
  const [existing, setExisting] = useState(false);
  const [over, setOver] = useState(false);

  function add(list: FileList | null) {
    if (!list) return;
    const ok: PickedFile[] = [];
    for (const f of Array.from(list)) {
      if (f.size > maxMb * 1024 * 1024) toast(`${f.name} is larger than ${maxMb} MB`, { error: true });
      else ok.push({ id: `${f.name}-${f.size}-${f.lastModified}`, file: f });
    }
    const seen = new Set(files.map((f) => f.id));
    onChange([...files, ...ok.filter((f) => !seen.has(f.id))]);
  }

  return (
    <div className={`txn-attach ${className ?? ""}`}>
      <div
        className={`txn-attach-drop ${dashed ? "dashed" : ""} ${over ? "over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          add(e.dataTransfer.files);
        }}
      >
        <button type="button" className="txn-link" onClick={() => input.current?.click()}>
          <Paperclip size={18} /> Add attachment
        </button>
        <span>Max file size: {maxMb} MB</span>
        <input ref={input} type="file" multiple hidden accept={ATTACH_ACCEPT} onChange={(e) => (add(e.target.files), (e.target.value = ""))} />
      </div>
      {files.length ? (
        <ul className="txn-attach-list">
          {files.map((f) => (
            <li key={f.id}>
              <Paperclip size={14} />
              <span className="txn-attach-name">{f.file.name}</span>
              <span className="muted">{fileSize(f.file.size)}</span>
              <button type="button" className="txn-icon sm" aria-label={`Remove ${f.file.name}`} onClick={() => onChange(files.filter((x) => x.id !== f.id))}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {showExisting ? (
        <button type="button" className="txn-link center" onClick={() => setExisting((v) => !v)}>
          Show existing
        </button>
      ) : null}
      {existing ? <p className="muted txn-attach-existing">Files you attach are listed on the saved record. Nothing has been attached to this one yet.</p> : null}
    </div>
  );
}

/** After a document is posted, attach the picked files to it (server document storage). */
export async function uploadAttachments(
  api: <T>(path: string, init?: RequestInit) => Promise<T>,
  entityType: "ArInvoice" | "ApBill" | "Journal" | "ItemReceipt" | "Project",
  entityId: string,
  files: PickedFile[],
) {
  let failed = 0;
  for (const f of files) {
    const form = new FormData();
    form.append("entityType", entityType);
    form.append("entityId", entityId);
    form.append("file", f.file);
    try {
      await api("/api/v1/books/documents/upload", { method: "POST", body: form });
    } catch {
      failed++;
    }
  }
  return failed;
}

/* ── Modals ────────────────────────────────────────────── */

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 520,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="txn-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="txn-modal" role="dialog" aria-modal="true" style={{ maxWidth: width }}>
        <div className="txn-modal-head">
          <h2>{title}</h2>
          <button type="button" className="txn-icon" aria-label="Close" onClick={onClose}>
            <X size={22} />
          </button>
        </div>
        <div className="txn-modal-body">{children}</div>
        {footer ? <div className="txn-modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function FeedbackModal({ onClose }: { onClose: () => void }) {
  const { toast } = useFeedback();
  const [rating, setRating] = useState("");
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  return (
    <Modal
      title="Give feedback"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="txn-btn-outline blue" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="txn-btn-primary"
            onClick={() => {
              if (!rating) return setError("Choose how this form worked for you.");
              if (text.trim().length < 5) return setError("Tell us a little more (at least 5 characters).");
              toast("Thanks — your feedback was sent to the Excel Edge team");
              onClose();
            }}
          >
            Send feedback
          </button>
        </>
      }
    >
      <p className="muted">How's this form working for you?</p>
      <div className="txn-segment" role="radiogroup">
        {["Great", "Okay", "Not good"].map((r) => (
          <button key={r} type="button" role="radio" aria-checked={rating === r} className={rating === r ? "on" : ""} onClick={() => (setRating(r), setError(""))}>
            {r}
          </button>
        ))}
      </div>
      <TextArea label="What could be better?" value={text} onChange={(v) => (setText(v), setError(""))} rows={4} error={error || undefined} />
    </Modal>
  );
}

export function RecurringModal({ kind, snapshot, onClose, defaultName }: { kind: TxnKind; snapshot: unknown; onClose: () => void; defaultName: string }) {
  const { toast } = useFeedback();
  const [form, setForm] = useState({ name: defaultName, interval: "MONTHLY" as RecurringTemplate["interval"], every: "1", startDate: new Date().toISOString().slice(0, 10), endDate: "", daysInAdvance: "0" });
  const v = useValidation();
  const schema = yup.object({
    name: yup.string().trim().required("Name the template").max(80, "Keep the name under 80 characters"),
    every: yup.number().typeError("Enter a number").integer("Whole numbers only").min(1, "At least 1").max(99, "At most 99"),
    startDate: yup.string().required("Choose a start date"),
    endDate: yup.string().test("after", "End date must be after the start date", function (val) {
      return !val || val > this.parent.startDate;
    }),
    daysInAdvance: yup.number().typeError("Enter a number").min(0, "Can't be negative").max(60, "At most 60 days"),
  });
  async function save() {
    if (!(await v.validate(schema, form))) return;
    saveRecurring({ kind, name: form.name.trim(), interval: form.interval, every: Number(form.every), startDate: form.startDate, endDate: form.endDate, daysInAdvance: Number(form.daysInAdvance), snapshot });
    toast(`Recurring template "${form.name.trim()}" saved`);
    onClose();
  }
  const set = (k: keyof typeof form) => (val: string) => (setForm((f) => ({ ...f, [k]: val })), v.clear(k));
  return (
    <Modal
      title={`Make recurring: ${TXN_LABELS[kind]}`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="txn-btn-outline blue" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="txn-btn-primary" onClick={save}>
            Save template
          </button>
        </>
      }
    >
      <div className="txn-form-grid">
        <TField label="Template name" required error={v.errors.name} className="span-2">
          <input className="txn-input" value={form.name} onChange={(e) => set("name")(e.target.value)} />
        </TField>
        <TField label="Interval">
          <Select
            value={form.interval}
            onChange={set("interval")}
            searchable={false}
            options={[
              { value: "DAILY", label: "Daily" },
              { value: "WEEKLY", label: "Weekly" },
              { value: "MONTHLY", label: "Monthly" },
              { value: "YEARLY", label: "Yearly" },
            ]}
          />
        </TField>
        <TField label="Every" error={v.errors.every}>
          <input className="txn-input" inputMode="numeric" value={form.every} onChange={(e) => set("every")(e.target.value)} />
        </TField>
        <TField label="Start date" required error={v.errors.startDate}>
          <input className="txn-input" type="date" value={form.startDate} onChange={(e) => set("startDate")(e.target.value)} />
        </TField>
        <TField label="End date" error={v.errors.endDate} hint="Leave empty to repeat with no end">
          <input className="txn-input" type="date" value={form.endDate} onChange={(e) => set("endDate")(e.target.value)} />
        </TField>
        <TField label="Create days in advance" error={v.errors.daysInAdvance}>
          <input className="txn-input" inputMode="numeric" value={form.daysInAdvance} onChange={(e) => set("daysInAdvance")(e.target.value)} />
        </TField>
      </div>
    </Modal>
  );
}

/** Red banner shown when a save fails (as in the cheque mockup). */
export function ErrorBanner({ message, onClose }: { message: string; onClose?: () => void }) {
  if (!message) return null;
  return (
    <div className="txn-error-banner" role="alert">
      <span className="txn-error-icon" aria-hidden="true">
        !
      </span>
      <span>{message}</span>
      {onClose ? (
        <button type="button" className="txn-icon sm" aria-label="Dismiss" onClick={onClose}>
          <X size={16} />
        </button>
      ) : null}
    </div>
  );
}

export function ValidationSummary({ count }: { count: number }) {
  if (!count) return null;
  return (
    <div className="txn-error-banner warn" role="alert">
      <span className="txn-error-icon" aria-hidden="true">
        !
      </span>
      <span>
        {count === 1 ? "1 field needs" : `${count} fields need`} your attention before you can save.
      </span>
    </div>
  );
}

/* ── Company header & document preview ─────────────────── */

const LOGO_KEY = "ee.company.logo";

export function useCompanyLogo() {
  const [logo, setLogo] = useState<string>(() => {
    try {
      return localStorage.getItem(LOGO_KEY) ?? "";
    } catch {
      return "";
    }
  });
  function update(dataUrl: string) {
    setLogo(dataUrl);
    try {
      if (dataUrl) localStorage.setItem(LOGO_KEY, dataUrl);
      else localStorage.removeItem(LOGO_KEY);
    } catch {
      // Logo stays for this session only.
    }
  }
  return [logo, update] as const;
}

export const COMPANY_PROFILE = {
  address1: "Gisozi, Gasabo, Kigali",
  address2: "ADARWA Building F 11",
  email: "enockiradukunda4@gmail.com",
  phone: "+250788701837",
};

export function CompanyBlock({ showEmail = true, showEdit = true }: { showEmail?: boolean; showEdit?: boolean }) {
  const { name } = useCompany();
  return (
    <div className="txn-company">
      <div className="txn-company-addr">
        <strong>{(name || "EXCEL EDGE CPA").toUpperCase()}</strong>
        <span>{COMPANY_PROFILE.address1}</span>
        <span>{COMPANY_PROFILE.address2}</span>
        {showEdit ? (
          <button type="button" className="txn-link" onClick={() => navigate("/settings/company")}>
            Edit company
          </button>
        ) : null}
      </div>
      <div className="txn-company-contact">
        {showEmail ? <span>✉ {COMPANY_PROFILE.email}</span> : null}
        <span>☏ {COMPANY_PROFILE.phone}</span>
      </div>
    </div>
  );
}

export function LogoPicker() {
  const [logo, setLogo] = useCompanyLogo();
  const input = useRef<HTMLInputElement>(null);
  const { toast } = useFeedback();
  return (
    <button type="button" className="txn-logo" onClick={() => input.current?.click()} aria-label="Change logo" title="Change logo">
      {logo ? <img src={logo} alt="Company logo" /> : <StoreIcon />}
      <span className="txn-logo-edit" aria-hidden="true">
        ✎
      </span>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (f.size > 1024 * 1024) return toast("Logo must be 1 MB or smaller", { error: true });
          const reader = new FileReader();
          reader.onload = () => setLogo(String(reader.result));
          reader.readAsDataURL(f);
        }}
      />
    </button>
  );
}

function StoreIcon() {
  return (
    <svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="4" aria-hidden="true">
      <path d="M8 24l4-14h40l4 14" />
      <path d="M8 24c0 4 3 7 7 7s7-3 7-7c0 4 3 7 7 7s7-3 7-7c0 4 3 7 7 7s7-3 7-7" />
      <path d="M12 31v23h40V31" />
      <path d="M26 54V40h12v14" />
    </svg>
  );
}

export type PreviewLine = { description: string; qty?: string; rate?: string; amount: number; date?: string };

export function DocPreview({
  docTitle,
  number,
  party,
  partyAddress,
  dates,
  lines,
  totals,
  note,
  accent = "#0077c5",
  font,
  mode,
}: {
  docTitle: string;
  number: string;
  party: string;
  partyAddress?: string;
  dates: Array<[string, string]>;
  lines: PreviewLine[];
  totals: Array<[string, string]>;
  note?: string;
  accent?: string;
  font?: string;
  mode: "email" | "pdf";
}) {
  const { name } = useCompany();
  const [logo] = useCompanyLogo();
  const total = totals[totals.length - 1]?.[1] ?? "";
  const doc = (
    <article className="txn-doc" style={{ fontFamily: font, ["--doc-accent" as string]: accent }}>
      <header className="txn-doc-head">
        <div>
          <h2>{docTitle.toUpperCase()}</h2>
          <strong>{(name || "EXCEL EDGE CPA").toUpperCase()}</strong>
          <div>{COMPANY_PROFILE.address1}</div>
          <div>{COMPANY_PROFILE.address2}</div>
          <div>{COMPANY_PROFILE.email}</div>
          <div>{COMPANY_PROFILE.phone}</div>
        </div>
        {logo ? <img src={logo} alt="" className="txn-doc-logo" /> : null}
      </header>
      <section className="txn-doc-meta">
        <div>
          <span className="txn-doc-k">Bill to</span>
          <strong>{party || "—"}</strong>
          {partyAddress ? <div className="pre">{partyAddress}</div> : null}
        </div>
        <dl>
          <div>
            <dt>{docTitle} no.</dt>
            <dd>{number || "—"}</dd>
          </div>
          {dates.map(([k, val]) => (
            <div key={k}>
              <dt>{k}</dt>
              <dd>{val ? date(val) : "—"}</dd>
            </div>
          ))}
        </dl>
      </section>
      <table className="txn-doc-lines">
        <thead>
          <tr>
            <th>Date</th>
            <th>Description</th>
            <th className="right">Qty</th>
            <th className="right">Rate</th>
            <th className="right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={5} className="muted">
                No lines yet
              </td>
            </tr>
          ) : (
            lines.map((l, i) => (
              <tr key={i}>
                <td>{l.date ? date(l.date) : ""}</td>
                <td>{l.description}</td>
                <td className="right">{l.qty}</td>
                <td className="right">{l.rate}</td>
                <td className="right">{amount(l.amount, 2)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <dl className="txn-doc-totals">
        {totals.map(([k, val], i) => (
          <div key={k} className={i === totals.length - 1 ? "strong" : ""}>
            <dt>{k}</dt>
            <dd>{val}</dd>
          </div>
        ))}
      </dl>
      {note ? <p className="txn-doc-note">{note}</p> : null}
    </article>
  );
  if (mode === "pdf") return <div className="txn-doc-pdf">{doc}</div>;
  return (
    <div className="txn-doc-email">
      <div className="txn-doc-email-card">
        <p className="muted">From: {(name || "Excel Edge CPA")}</p>
        <h3>
          {docTitle} {number} from {name || "Excel Edge CPA"}
        </h3>
        <div className="txn-doc-email-due">
          <span>{docTitle === "Invoice" ? "Balance due" : "Total"}</span>
          <strong>{total}</strong>
        </div>
        <p>Dear {party || "customer"},</p>
        <p>Here's your {docTitle.toLowerCase()}. We appreciate your business.</p>
        <p>{note}</p>
      </div>
      {doc}
    </div>
  );
}

/** Close a full-page form: go back when there's history, else to a sensible page. */
export function closeTo(fallback: string) {
  if (window.history.length > 1) window.history.back();
  else navigate(fallback);
}
