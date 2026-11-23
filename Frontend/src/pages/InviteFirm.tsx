import { Building2, Mail } from "lucide-react";
import { type FormEvent, useState } from "react";
import { useFeedback } from "../components/feedback";
import { Link, navigate } from "../lib/router";
import { useSession } from "../lib/session";
import { roleAccess, usersApi } from "../lib/users";
import { AccessList } from "./ManageUsers";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Invite an accounting firm (QuickBooks "Accounting firms"): the firm's contact gets an Excel
 * Edge invitation with Accountant access, and the firm is listed on the Accounting firms tab.
 */
export function InviteFirm() {
  const session = useSession();
  const { toast } = useFeedback();
  const [firmName, setFirmName] = useState("");
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canManage = session.can("setup:approve");
  const firmError = touched && firmName.trim().length < 2 ? "Enter the firm's name" : "";
  const emailError = touched && !EMAIL_RE.test(email.trim()) ? "Enter a valid email address" : "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (firmName.trim().length < 2 || !EMAIL_RE.test(email.trim())) return;
    setBusy(true);
    setError("");
    try {
      await usersApi.inviteFirm(session.api, { firmName: firmName.trim(), email: email.trim() });
      toast(`Invitation sent to ${firmName.trim()}.`);
      navigate("/users/accounting-firms");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!canManage)
    return (
      <div className="ee-manage">
        <header className="ee-manage-head">
          <div>
            <h1>Invite an accounting firm</h1>
            <p>Only a company admin can invite an accounting firm.</p>
          </div>
        </header>
        <Link to="/users/accounting-firms" className="ee-link-btn ee-manage-back">
          ← Back to accounting firms
        </Link>
      </div>
    );

  return (
    <form className="ee-manage" onSubmit={(e) => void submit(e)} noValidate>
      <div className="ee-manage-crumb">
        <Link to="/users">Users</Link>
        <span>/</span>
        <Link to="/users/accounting-firms">Accounting firms</Link>
        <span>/</span>
        <span>Invite firm</span>
      </div>

      <header className="ee-manage-head">
        <div>
          <h1>Invite an accounting firm</h1>
          <p>Your accountant gets their own sign-in and works on your books with Accountant access.</p>
        </div>
      </header>

      {error && (
        <div className="ee-manage-alert" role="alert">
          <span>{error}</span>
        </div>
      )}

      <section className="ee-manage-form-card">
        <h2>Firm details</h2>
        <p className="ee-manage-form-blurb">We'll email your accountant an invitation. The link works for 7 days.</p>
        <div className="ee-manage-form-grid">
          <label>
            <span>
              Firm name <span className="req">*</span>
            </span>
            <span className="ee-input-icon">
              <Building2 size={16} aria-hidden="true" />
              <input className={`input ${firmError ? "invalid" : ""}`} value={firmName} onChange={(e) => setFirmName(e.target.value)} placeholder="e.g. Kigali Accounting Partners" aria-invalid={Boolean(firmError)} />
            </span>
            {firmError && <span className="field-error">{firmError}</span>}
          </label>
          <label>
            <span>
              Accountant's email <span className="req">*</span>
            </span>
            <span className="ee-input-icon">
              <Mail size={16} aria-hidden="true" />
              <input className={`input ${emailError ? "invalid" : ""}`} type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="accountant@firm.com" aria-invalid={Boolean(emailError)} />
            </span>
            {emailError && <span className="field-error">{emailError}</span>}
          </label>
        </div>
      </section>

      <section className="ee-manage-form-card">
        <h2>What your accountant can do</h2>
        <p className="ee-manage-form-blurb">Accountant access: bookkeeping, banking, tax, reports and period close. They can't manage users.</p>
        <AccessList access={roleAccess("ACCOUNTANT")} />
      </section>

      <footer className="ee-manage-form-foot">
        <button type="button" className="btn ee-btn-outline-blue" onClick={() => navigate("/users/accounting-firms")}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          <Mail size={16} strokeWidth={1.75} aria-hidden="true" /> {busy ? "Sending…" : "Send invite"}
        </button>
      </footer>
    </form>
  );
}
