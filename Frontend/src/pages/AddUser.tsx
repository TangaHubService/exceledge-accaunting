import { Mail } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { useFeedback } from "../components/feedback";
import { Link, navigate } from "../lib/router";
import { useSession } from "../lib/session";
import { usersApi, type CustomRole } from "../lib/users";
import { AccessList, RolePicker, accessForPick, type PickedRole } from "./ManageUsers";

type Branch = { id: string; externalErpBranchId: string; name: string | null; code: string | null; isActive: boolean };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AddUser() {
  const session = useSession();
  const { toast } = useFeedback();
  const [email, setEmail] = useState("");
  const [pick, setPick] = useState<PickedRole | null>(null);
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [branchId, setBranchId] = useState("");
  const [branches, setBranches] = useState<Branch[]>([]);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canManage = session.can("setup:approve");

  useEffect(() => {
    usersApi
      .roles(session.api)
      .then((r) => setCustomRoles(r.roles))
      .catch(() => setCustomRoles([]));
    session
      .api<Branch[]>("/api/v1/setup/branches")
      .then((rows) => setBranches(rows.filter((b) => b.isActive && /^\d+$/.test(b.externalErpBranchId))))
      .catch(() => setBranches([]));
  }, [session]);

  const emailError = touched && !EMAIL_RE.test(email.trim()) ? "Enter a valid email address" : "";
  const roleError = touched && !pick ? "Choose a role" : "";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (!EMAIL_RE.test(email.trim()) || !pick) return;
    setBusy(true);
    setError("");
    try {
      const choice = pick.kind === "custom" ? { customRoleId: pick.id } : { role: pick.role };
      await usersApi.invite(session.api, { email: email.trim(), ...choice, branchId: branchId ? Number(branchId) : null });
      toast(`Invitation sent to ${email.trim()}.`);
      navigate("/users");
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
            <h1>Add user</h1>
            <p>Only a company admin can invite people to this company.</p>
          </div>
        </header>
        <Link to="/users" className="ee-link-btn ee-manage-back">
          ← Back to users
        </Link>
      </div>
    );

  return (
    <form className="ee-manage" onSubmit={submit} noValidate>
      <div className="ee-manage-crumb">
        <Link to="/users">Users</Link>
        <span>/</span>
        <span>Add user</span>
      </div>

      <header className="ee-manage-head">
        <div>
          <h1>Add user</h1>
          <p>Invite a team member and choose what they can do.</p>
        </div>
      </header>

      {error && (
        <div className="ee-manage-alert" role="alert">
          <span>{error}</span>
        </div>
      )}

      <section className="ee-manage-form-card">
        <h2>Who are you inviting?</h2>
        <p className="ee-manage-form-blurb">
          We'll email them an invitation to join your company on Excel Edge. They add their own name and password when they accept. The link
          works for 7 days.
        </p>
        <div className="ee-manage-form-grid">
          <label>
            <span>
              Email address <span className="req">*</span>
            </span>
            <input
              className={`input ${emailError ? "invalid" : ""}`}
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              aria-invalid={Boolean(emailError)}
            />
            {emailError && <span className="field-error">{emailError}</span>}
          </label>
          {branches.length > 0 && (
            <label>
              <span>Branch</span>
              <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                <option value="">All branches</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.externalErpBranchId}>
                    {b.name ?? b.code ?? `Branch ${b.externalErpBranchId}`}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </section>

      <section className="ee-manage-form-card">
        <h2>
          Assign a role <span className="req">*</span>
        </h2>
        <p className="ee-manage-form-blurb">Pick a built-in role, or one of your custom roles. Each person sees only what their role allows.</p>
        <div className="ee-manage-role-row">
          <div className="ee-manage-role-col">
            <RolePicker value={pick} onChange={setPick} customRoles={customRoles} />
            {roleError && <span className="field-error">{roleError}</span>}
            {canManage && (
              <Link to="/users/roles/new" className="ee-link-btn ee-manage-newrole">
                + Create a custom role
              </Link>
            )}
          </div>
          <aside className="ee-manage-role-info">
            <div>
              <strong>{pick ? "What this role can do" : "Choose a role to see its access"}</strong>
              {accessForPick(pick, customRoles) && <AccessList access={accessForPick(pick, customRoles)!} />}
            </div>
          </aside>
        </div>
      </section>

      <footer className="ee-manage-form-foot">
        <button type="button" className="btn ee-btn-outline-blue" onClick={() => navigate("/users")}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          <Mail size={16} strokeWidth={1.75} aria-hidden="true" /> {busy ? "Sending…" : "Send invite"}
        </button>
      </footer>
    </form>
  );
}
