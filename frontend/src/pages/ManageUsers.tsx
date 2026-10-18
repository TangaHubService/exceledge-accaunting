import { BookOpen, ChevronDown, MoreVertical, Plus, Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, navigate, useLocation } from "../lib/router";
import { MANAGE_ROLES, MANAGE_USERS, SUGGESTED_ROLES } from "../lib/users-dummy";

type Tab = "users" | "roles" | "firms";

function tabFromPath(path: string, queryTab: string | null): Tab {
  if (path.includes("/accounting-firms") || queryTab === "firms") return "firms";
  if (path.includes("/roles") || queryTab === "roles") return "roles";
  return "users";
}

export function ManageUsers() {
  const { path, query } = useLocation();
  const tab = tabFromPath(path, query.get("tab"));
  const [q, setQ] = useState("");

  const users = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return MANAGE_USERS;
    return MANAGE_USERS.filter((u) => u.name.toLowerCase().includes(s) || u.email.toLowerCase().includes(s));
  }, [q]);

  const roles = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return MANAGE_ROLES;
    return MANAGE_ROLES.filter((r) => r.name.toLowerCase().includes(s) || r.description.toLowerCase().includes(s));
  }, [q]);

  const subtitle =
    tab === "roles"
      ? "Define roles and control access across your company."
      : tab === "firms"
        ? "Collaborate with your accountant in one secure workspace."
        : "Control who can access your company and what they can do.";

  return (
    <div className="ee-manage">
      <header className="ee-manage-head">
        <div>
          <h1>Manage users</h1>
          <p>{subtitle}</p>
        </div>
      </header>

      <nav className="ee-manage-tabs" aria-label="Manage users sections">
        <Link to="/users" className={tab === "users" ? "active" : ""}>
          Users
        </Link>
        <Link to="/users/roles" className={tab === "roles" ? "active" : ""}>
          Roles
        </Link>
        <Link to="/users/accounting-firms" className={tab === "firms" ? "active" : ""}>
          Accounting firms
        </Link>
      </nav>

      {tab !== "firms" && (
        <div className="ee-manage-suggest">
          <div className="ee-manage-suggest-label">
            <Users size={16} strokeWidth={1.5} aria-hidden="true" />
            Suggested roles for your team
          </div>
          <div className="ee-manage-suggest-pills">
            {SUGGESTED_ROLES.map((r) => (
              <button type="button" key={r} className="ee-manage-pill">
                {r}
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === "users" && (
        <>
          <div className="ee-manage-toolbar">
            <label className="ee-manage-search">
              <Search size={16} strokeWidth={1.5} aria-hidden="true" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users" aria-label="Search users" />
            </label>
            <div className="ee-manage-toolbar-right">
              <button type="button" className="ee-link-btn">
                <BookOpen size={14} strokeWidth={1.5} aria-hidden="true" /> Learn more
              </button>
              <button type="button" className="btn btn-primary" onClick={() => navigate("/users/new")}>
                <Plus size={16} strokeWidth={1.75} aria-hidden="true" /> Add user
              </button>
            </div>
          </div>

          <div className="ee-manage-card">
            <table className="ee-manage-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Role</th>
                  <th>Billable</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <span className="ee-manage-user">
                        <span className="ee-manage-avatar" style={{ background: u.color }}>
                          {u.initials}
                        </span>
                        {u.name}
                      </span>
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <span className="ee-manage-status">
                        <span className="dot" /> Active
                      </span>
                    </td>
                    <td>{u.role}</td>
                    <td>{u.billable}</td>
                    <td>
                      <span className="ee-manage-action-split">
                        <button type="button" className="btn ee-btn-outline-blue btn-sm">
                          {u.action}
                        </button>
                        <button type="button" className="btn ee-btn-outline-blue btn-sm ee-manage-split-caret" aria-label="More">
                          <ChevronDown size={14} strokeWidth={1.75} />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ee-manage-count">{users.length} users</div>
          </div>
        </>
      )}

      {tab === "roles" && (
        <>
          <div className="ee-manage-toolbar">
            <label className="ee-manage-search">
              <Search size={16} strokeWidth={1.5} aria-hidden="true" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search roles" aria-label="Search roles" />
            </label>
            <div className="ee-manage-toolbar-right">
              <button type="button" className="ee-link-btn">
                <BookOpen size={14} strokeWidth={1.5} aria-hidden="true" /> Learn about custom roles
              </button>
              <button type="button" className="btn btn-primary">
                <Plus size={16} strokeWidth={1.75} aria-hidden="true" /> Add role
              </button>
            </div>
          </div>

          <div className="ee-manage-card">
            <table className="ee-manage-table">
              <thead>
                <tr>
                  <th>Role name</th>
                  <th>Description</th>
                  <th>Users</th>
                  <th>Updated</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((r) => (
                  <tr key={r.name}>
                    <td>
                      <strong>{r.name}</strong>
                    </td>
                    <td className="ee-manage-desc">{r.description}</td>
                    <td>{r.users}</td>
                    <td>{r.updated}</td>
                    <td>
                      <span className="ee-manage-role-action">
                        <button type="button" className="ee-link-btn">
                          {r.action}
                        </button>
                        <button type="button" className="ee-icon-btn" aria-label="More actions">
                          <MoreVertical size={16} strokeWidth={1.5} />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "firms" && (
        <div className="ee-manage-empty-card">
          <div className="ee-manage-empty-art" aria-hidden="true">
            <div className="ee-manage-empty-blob" />
            <Users size={48} strokeWidth={1.25} />
          </div>
          <h2>Better business starts with your accountant.</h2>
          <p>Invite your accounting firm to collaborate on your books in Excel Edge ERP.</p>
          <p className="ee-manage-empty-note">No accounting firms have been added yet.</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate("/users/accounting-firms/invite")}>
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" /> Invite firm
          </button>
        </div>
      )}
    </div>
  );
}
