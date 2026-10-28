import { Building2, Info, X } from "lucide-react";
import { useState } from "react";
import { Link, navigate } from "../lib/router";

export function InviteFirm() {
  const [mode, setMode] = useState<"id" | "email">("id");
  const [firmId, setFirmId] = useState("");
  const [email, setEmail] = useState("");
  const canSend = mode === "id" ? firmId.replace(/\s/g, "").length >= 16 : Boolean(email.trim());

  return (
    <div className="ee-manage">
      <Link to="/users/accounting-firms" className="ee-link-btn ee-manage-back">
        ← Back to accounting firms
      </Link>
      <div className="ee-manage-crumb">
        <span>Users</span>
        <span>/</span>
        <span>Accounting firms</span>
        <span>/</span>
        <span>Invite firm</span>
      </div>

      <header className="ee-manage-head">
        <div>
          <h1>Invite an accounting firm</h1>
          <p>Connect your accountant to your Excel Edge ERP company.</p>
        </div>
      </header>

      <div className="ee-invite-card">
        <header className="ee-invite-card-head">
          <div className="ee-invite-icon" aria-hidden="true">
            <Building2 size={22} strokeWidth={1.5} />
          </div>
          <h2>Choose how to invite your accountant</h2>
          <button type="button" className="ee-icon-btn" aria-label="Close" onClick={() => navigate("/users/accounting-firms")}>
            <X size={18} strokeWidth={1.5} />
          </button>
        </header>

        <div className="ee-settings-info">
          <Info size={16} strokeWidth={1.75} aria-hidden="true" />
          <span>Your accountant and members of their firm will have admin access to your company data. Invitations expire after 30 days.</span>
        </div>

        <label className="ee-invite-radio">
          <input type="radio" name="invite-mode" checked={mode === "id"} onChange={() => setMode("id")} />
          <span>Enter my accountant&apos;s firm ID</span>
        </label>
        {mode === "id" && (
          <div className="ee-invite-field">
            <label htmlFor="firm-id">Firm ID</label>
            <input
              id="firm-id"
              className="input"
              value={firmId}
              onChange={(e) => setFirmId(e.target.value)}
              placeholder="Enter the 16-digit firm ID"
            />
            <p className="ee-settings-hint">Ask your accountant for the firm ID shown in their Client invitations tab.</p>
          </div>
        )}

        <label className="ee-invite-radio">
          <input type="radio" name="invite-mode" checked={mode === "email"} onChange={() => setMode("email")} />
          <span>Enter my accountant&apos;s email</span>
        </label>
        {mode === "email" && (
          <div className="ee-invite-field">
            <label htmlFor="firm-email">Email</label>
            <input
              id="firm-email"
              className="input"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="accountant@firm.com"
            />
          </div>
        )}

        <footer className="ee-invite-foot">
          <button type="button" className="btn ee-btn-outline-blue" onClick={() => navigate("/users/accounting-firms")}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!canSend}>
            Send Invite
          </button>
        </footer>
      </div>
    </div>
  );
}
