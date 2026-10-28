import { ChevronDown, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, navigate } from "../lib/router";
import { ADD_USER_ROLES } from "../lib/users-dummy";

export function AddUser() {
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("");
  const [open, setOpen] = useState(false);

  const canSend = Boolean(first.trim() && last.trim() && email.trim() && role && !role.startsWith("+"));

  const roles = useMemo(() => ADD_USER_ROLES, []);

  return (
    <div className="ee-manage">
      <div className="ee-manage-crumb">
        <span>Users</span>
        <span>/</span>
        <span>Add user</span>
      </div>
      <Link to="/users" className="ee-link-btn ee-manage-back">
        ← Back to users
      </Link>

      <header className="ee-manage-head">
        <div>
          <h1>Add user</h1>
          <p>Invite a team member and choose their access permissions.</p>
        </div>
      </header>

      <section className="ee-manage-form-card">
        <h2>Personal information</h2>
        <p className="ee-manage-form-blurb">We will email an invitation to join your company on Excel Edge ERP.</p>
        <div className="ee-manage-form-grid">
          <label>
            First name <span className="req">*</span>
            <input className="input" value={first} onChange={(e) => setFirst(e.target.value)} placeholder="Enter first name" />
          </label>
          <label>
            Last name <span className="req">*</span>
            <input className="input" value={last} onChange={(e) => setLast(e.target.value)} placeholder="Enter last name" />
          </label>
          <label>
            Email address <span className="req">*</span>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />
          </label>
        </div>
      </section>

      <section className="ee-manage-form-card">
        <h2>Assign a role</h2>
        <p className="ee-manage-form-blurb">
          Choose an existing role or create a custom role.{" "}
          <button type="button" className="ee-link-btn" style={{ padding: 0 }}>
            View role descriptions
          </button>
        </p>
        <div className="ee-manage-role-row">
          <div className="ee-manage-role-select">
            <button type="button" className="ee-manage-select" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
              <span>{role || "Select a role"}</span>
              <ChevronDown size={16} strokeWidth={1.5} />
            </button>
            {open && (
              <ul className="ee-manage-select-menu" role="listbox">
                {roles.map((r) => (
                  <li key={r}>
                    <button
                      type="button"
                      className={r.startsWith("+") ? "add" : ""}
                      onClick={() => {
                        setRole(r);
                        setOpen(false);
                      }}
                    >
                      {r}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <aside className="ee-manage-role-info">
            <Users size={18} strokeWidth={1.5} aria-hidden="true" />
            <div>
              <strong>Access follows their role</strong>
              <p>Each team member sees only the features and company data allowed by their assigned role.</p>
            </div>
          </aside>
        </div>
      </section>

      <footer className="ee-manage-form-foot">
        <button type="button" className="btn ee-btn-outline-blue" onClick={() => navigate("/users")}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" disabled={!canSend}>
          Send invite
        </button>
      </footer>
    </div>
  );
}
