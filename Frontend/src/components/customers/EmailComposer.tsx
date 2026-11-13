import { Mail } from "lucide-react";
import { useState } from "react";
import { useFeedback } from "../feedback";
import { useResource, useSession } from "../../lib/session";

/**
 * Inline "send by email" form: To (prefilled with the customer's address), Cc and an optional message.
 * The server builds the email, attaches the PDF and sends it through the configured SMTP account.
 */
export function EmailComposer({
  title,
  defaultTo,
  endpoint,
  extraBody,
  sendLabel = "Send",
  messagePlaceholder,
  onSent,
  onCancel,
}: {
  title: string;
  defaultTo?: string | null;
  endpoint: string;
  extraBody?: Record<string, unknown>;
  sendLabel?: string;
  messagePlaceholder?: string;
  onSent?: () => void;
  onCancel: () => void;
}) {
  const { api } = useSession();
  const { toast } = useFeedback();
  const status = useResource<{ configured: boolean }>("/api/v1/ar/email/status");
  const [to, setTo] = useState(defaultTo ?? "");
  const [cc, setCc] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    if (!to.trim()) return setError("Enter at least one email address.");
    setBusy(true);
    setError("");
    try {
      const res = await api<{ to: string }>(endpoint, { method: "POST", body: JSON.stringify({ to, cc: cc || undefined, message: message.trim() || undefined, ...extraBody }) });
      toast(`Sent to ${res.to}`);
      onSent?.();
      onCancel();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="email-composer">
      <div className="email-composer-head">
        <Mail size={15} aria-hidden="true" />
        <strong>{title}</strong>
      </div>
      {status.data && !status.data.configured && (
        <p className="notice-inline">Email isn't set up on the server yet, so this can't be sent. Ask an administrator to add the mail settings.</p>
      )}
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      <label className="field">
        <span className="field-label">To</span>
        <input className="input" type="text" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@company.rw, another@company.rw" />
      </label>
      <label className="field">
        <span className="field-label">Cc</span>
        <input className="input" type="text" value={cc} onChange={(e) => setCc(e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">Message (optional)</span>
        <textarea className="input" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={messagePlaceholder ?? "Leave empty to use the standard wording"} maxLength={4000} />
        <span className="field-hint">The PDF is attached automatically.</span>
      </label>
      <div className="email-composer-actions">
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-sm btn-primary" disabled={busy || status.data?.configured === false} onClick={() => void send()}>
          {busy ? "Sending…" : sendLabel}
        </button>
      </div>
    </div>
  );
}
