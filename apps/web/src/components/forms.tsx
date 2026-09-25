import { type ReactNode, useState } from "react";
import { amount } from "../lib/format";
import { useFeedback } from "./feedback";

/** Parse "1,250,000" → 1250000; empty → NaN. */
export function parseAmount(text: string): number {
  const cleaned = text.replace(/[,\s]/g, "");
  return cleaned === "" ? Number.NaN : Number(cleaned);
}

export function MoneyInput({
  value,
  onChange,
  invalid,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  return (
    <input
      className={`input num ${invalid ? "invalid" : ""}`}
      inputMode="decimal"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ""))}
      onBlur={() => {
        const n = parseAmount(value);
        if (Number.isFinite(n)) onChange(amount(n, n % 1 ? 2 : 0));
      }}
      onFocus={(e) => e.target.select()}
      {...rest}
    />
  );
}

export function useSubmit(onDone?: () => void) {
  const { toast } = useFeedback();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(action: () => Promise<string>) {
    setBusy(true);
    setError("");
    try {
      const message = await action();
      toast(message);
      onDone?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

export function FormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <div className="notice error" role="alert" style={{ marginBottom: 16 }}>
      {message}
    </div>
  );
}

export function Footer({ onCancel, busy, label, formId, danger }: { onCancel: () => void; busy: boolean; label: string; formId: string; danger?: boolean }) {
  return (
    <>
      <button type="button" className="btn" onClick={onCancel}>
        Cancel
      </button>
      <button type="submit" form={formId} className={`btn ${danger ? "btn-danger" : "btn-primary"}`} disabled={busy}>
        {busy ? "Saving…" : label}
      </button>
    </>
  );
}

export function SummaryRows({ rows }: { rows: Array<[ReactNode, ReactNode, boolean?]> }) {
  return (
    <table className="table" style={{ marginTop: 18, fontSize: 13.5 }}>
      <tbody>
        {rows.map(([label, value, total], i) => (
          <tr key={i} style={total ? { fontWeight: 600 } : undefined}>
            <td style={{ padding: "6px 0", borderBottom: total ? 0 : undefined, borderTop: total ? "1px solid var(--line-strong)" : undefined }}>{label}</td>
            <td className="num" style={{ padding: "6px 0", borderBottom: total ? 0 : undefined, borderTop: total ? "1px solid var(--line-strong)" : undefined }}>
              {value}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function addDays(day: string, days: number) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
