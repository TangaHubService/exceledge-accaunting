import { Info, Plus, RefreshCw, Search, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useFeedback } from "../components/feedback";
import { Drawer, Menu } from "../components/ui";
import { Link, navigate, useLocation } from "../lib/router";
import { useSession } from "../lib/session";
import {
  ASSIGNABLE_ROLES,
  ROLE_INFO,
  avatarFor,
  roleAccess,
  roleLabel,
  usersApi,
  type AssignableRole,
  type ManagedUser,
  type PendingInvitation,
  type UsersPayload,
} from "../lib/users";

type Tab = "users" | "roles" | "firms";
type StatusFilter = "all" | "ACTIVE" | "INACTIVE" | "INVITED";

function tabFromPath(path: string, queryTab: string | null): Tab {
  if (path.includes("/accounting-firms") || queryTab === "firms") return "firms";
  if (path.includes("/roles") || queryTab === "roles") return "roles";
  return "users";
}

type Row =
  | { kind: "user"; key: string; user: ManagedUser }
  | { kind: "invite"; key: string; invite: PendingInvitation };

const STATUS_CHIP: Record<string, { label: string; tone: string }> = {
  ACTIVE: { label: "Active", tone: "active" },
  INACTIVE: { label: "Inactive", tone: "inactive" },
  INVITED: { label: "Invited", tone: "invited" },
  EXPIRED: { label: "Invite expired", tone: "expired" },
};

function StatusChip({ status }: { status: string }) {
  const chip = STATUS_CHIP[status] ?? { label: status, tone: "inactive" };
  return (
    <span className={`ee-manage-status ${chip.tone}`}>
      <span className="dot" /> {chip.label}
    </span>
  );
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export function ManageUsers() {
  const { path, query } = useLocation();
  const session = useSession();
  const { toast, confirm } = useFeedback();
  const tab = tabFromPath(path, query.get("tab"));
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [data, setData] = useState<UsersPayload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [openRole, setOpenRole] = useState<string | null>(null);

  const canManage = session.can("setup:approve");
  const isSystemOwner = session.role?.toUpperCase() === "SYSTEM_OWNER";
  const myEmail = session.email?.toLowerCase();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await usersApi.list(session.api));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session.api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(key: string, action: () => Promise<unknown>, done: string) {
    setBusyKey(key);
    try {
      await action();
      toast(done);
      await load();
    } catch (e) {
      toast((e as Error).message, { error: true });
    } finally {
      setBusyKey(null);
    }
  }

  const rows = useMemo<Row[]>(() => {
    if (!data) return [];
    const s = q.trim().toLowerCase();
    const matches = (name: string, email: string) => !s || name.toLowerCase().includes(s) || email.toLowerCase().includes(s);
    const users: Row[] = data.users
      .filter((u) => matches(u.name, u.email))
      .filter((u) => statusFilter === "all" || statusFilter === u.status)
      .sort((a, b) => Number(b.isOwner) - Number(a.isOwner) || a.name.localeCompare(b.name))
      .map((u) => ({ kind: "user", key: `u${u.id}`, user: u }));
    const invites: Row[] = data.invitations
      .filter((i) => matches("", i.email))
      .filter(() => statusFilter === "all" || statusFilter === "INVITED")
      .map((i) => ({ kind: "invite", key: `i${i.id}`, invite: i }));
    return [...users, ...invites];
  }, [data, q, statusFilter]);

  const roleCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const u of data?.users ?? []) if (u.status === "ACTIVE") counts.set(u.role, (counts.get(u.role) ?? 0) + 1);
    return counts;
  }, [data]);

  const activeCount = data?.users.filter((u) => u.status === "ACTIVE").length ?? 0;

  function userActions(u: ManagedUser) {
    if (!canManage) return <span className="ee-manage-muted">—</span>;
    if (u.isOwner) return <span className="ee-manage-muted" title="The primary admin can't be changed here.">—</span>;
    if (u.email.toLowerCase() === myEmail) return <span className="ee-manage-muted">You</span>;
    if (u.role === "ADMIN" && !isSystemOwner)
      return (
        <span className="ee-manage-muted" title="Only the Excel Edge system owner can change another admin.">
          Company admin
        </span>
      );
    const key = `u${u.id}`;
    const busy = busyKey === key;
    const remove = {
      label: "Remove from company",
      onSelect: async () => {
        const ok = await confirm({
          title: `Remove ${u.name}?`,
          body: "They lose access to this company straight away. Their past work stays in the books and the audit log. You can invite them again later.",
          confirmLabel: "Remove user",
          danger: true,
        });
        if (ok) void run(key, () => usersApi.remove(session.api, u.id), `${u.name} was removed from the company.`);
      },
    };
    if (u.status === "INACTIVE")
      return (
        <span className="ee-manage-action-split">
          <button
            type="button"
            className="btn ee-btn-outline-blue btn-sm"
            disabled={busy}
            onClick={() => void run(key, () => usersApi.update(session.api, u.id, { isActive: true }), `${u.name} can sign in again.`)}
          >
            Reactivate
          </button>
          <Menu label="" ariaLabel={`More actions for ${u.name}`} triggerClassName="btn ee-btn-outline-blue btn-sm ee-manage-split-caret" items={[remove]} />
        </span>
      );
    return (
      <span className="ee-manage-action-split">
        <button type="button" className="btn ee-btn-outline-blue btn-sm" disabled={busy} onClick={() => setEditing(u)}>
          Edit
        </button>
        <Menu
          label=""
          ariaLabel={`More actions for ${u.name}`}
          triggerClassName="btn ee-btn-outline-blue btn-sm ee-manage-split-caret"
          items={[
            {
              label: "Make inactive",
              onSelect: async () => {
                const ok = await confirm({
                  title: `Make ${u.name} inactive?`,
                  body: "They won't be able to sign in to Excel Edge until you reactivate them. Nothing they recorded is changed.",
                  confirmLabel: "Make inactive",
                  danger: true,
                });
                if (ok) void run(key, () => usersApi.update(session.api, u.id, { isActive: false }), `${u.name} is now inactive.`);
              },
            },
            remove,
          ]}
        />
      </span>
    );
  }

  function inviteActions(i: PendingInvitation) {
    if (!canManage) return <span className="ee-manage-muted">—</span>;
    const key = `i${i.id}`;
    return (
      <span className="ee-manage-action-split">
        <button
          type="button"
          className="btn ee-btn-outline-blue btn-sm"
          disabled={busyKey === key}
          onClick={() => void run(key, () => usersApi.resendInvite(session.api, i.id), `A new invitation was sent to ${i.email}.`)}
        >
          Resend
        </button>
        <Menu
          label=""
          ariaLabel={`More actions for ${i.email}`}
          triggerClassName="btn ee-btn-outline-blue btn-sm ee-manage-split-caret"
          items={[
            {
              label: "Cancel invite",
              onSelect: async () => {
                const ok = await confirm({
                  title: `Cancel the invitation to ${i.email}?`,
                  body: "The link in their email will stop working.",
                  confirmLabel: "Cancel invite",
                  danger: true,
                });
                if (ok) void run(key, () => usersApi.cancelInvite(session.api, i.id), `Invitation to ${i.email} cancelled.`);
              },
            },
          ]}
        />
      </span>
    );
  }

  const subtitle =
    tab === "roles"
      ? "See what each role can do in your company."
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

      {tab !== "firms" && error && (
        <div className="ee-manage-alert" role="alert">
          <span>{error}</span>
          <button type="button" className="ee-link-btn" onClick={() => void load()}>
            <RefreshCw size={14} aria-hidden="true" /> Try again
          </button>
        </div>
      )}

      {tab === "users" && (
        <>
          <div className="ee-manage-toolbar">
            <div className="ee-manage-toolbar-left">
              <label className="ee-manage-search">
                <Search size={16} strokeWidth={1.5} aria-hidden="true" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email" aria-label="Search users" />
              </label>
              <select
                className="input ee-manage-filter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                aria-label="Filter by status"
              >
                <option value="all">All statuses</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
                <option value="INVITED">Invited</option>
              </select>
            </div>
            {canManage && (
              <div className="ee-manage-toolbar-right">
                <button type="button" className="btn btn-primary" onClick={() => navigate("/users/new")}>
                  <Plus size={16} strokeWidth={1.75} aria-hidden="true" /> Add user
                </button>
              </div>
            )}
          </div>

          <div className="ee-manage-card">
            <table className="ee-manage-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Role</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {loading && !data && (
                  <tr>
                    <td colSpan={5} className="ee-manage-muted">
                      Loading users…
                    </td>
                  </tr>
                )}
                {data && rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="ee-manage-muted">
                      No users match your search.
                    </td>
                  </tr>
                )}
                {rows.map((row) => {
                  if (row.kind === "user") {
                    const u = row.user;
                    const av = avatarFor(u.name);
                    return (
                      <tr key={row.key} className={u.status === "INACTIVE" ? "is-inactive" : undefined}>
                        <td>
                          <span className="ee-manage-user">
                            <span className="ee-manage-avatar" style={{ background: av.color }}>
                              {av.initials}
                            </span>
                            <span>
                              {u.name}
                              {u.isOwner && <span className="ee-manage-tag">Primary admin</span>}
                            </span>
                          </span>
                        </td>
                        <td>{u.email}</td>
                        <td>
                          <StatusChip status={u.status} />
                        </td>
                        <td>{roleLabel(u.role)}</td>
                        <td>{userActions(u)}</td>
                      </tr>
                    );
                  }
                  const i = row.invite;
                  const av = avatarFor(i.email);
                  return (
                    <tr key={row.key}>
                      <td>
                        <span className="ee-manage-user">
                          <span className="ee-manage-avatar invited" style={{ borderColor: av.color, color: av.color }}>
                            {av.initials}
                          </span>
                          <span className="ee-manage-muted">
                            Invitation sent {formatDate(i.invitedAt)}
                            {i.invitedBy ? ` by ${i.invitedBy}` : ""}
                          </span>
                        </span>
                      </td>
                      <td>{i.email}</td>
                      <td>
                        <StatusChip status={i.status} />
                      </td>
                      <td>{roleLabel(i.role)}</td>
                      <td>{inviteActions(i)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {data && (
              <div className="ee-manage-count">
                {activeCount} active {activeCount === 1 ? "user" : "users"}
                {data.invitations.length > 0 && ` · ${data.invitations.length} pending ${data.invitations.length === 1 ? "invitation" : "invitations"}`}
              </div>
            )}
          </div>
        </>
      )}

      {tab === "roles" && (
        <>
          <div className="ee-manage-note">
            <Info size={16} strokeWidth={1.5} aria-hidden="true" />
            <span>
              Access follows these Excel Edge roles. Custom roles, where you pick access area by area, aren't available yet.
            </span>
          </div>
          <div className="ee-manage-card">
            <table className="ee-manage-table">
              <thead>
                <tr>
                  <th>Role name</th>
                  <th>Description</th>
                  <th>Users</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {ASSIGNABLE_ROLES.map((r) => (
                  <RoleRow
                    key={r}
                    role={r}
                    users={roleCounts.get(r) ?? 0}
                    open={openRole === r}
                    onToggle={() => setOpenRole((o) => (o === r ? null : r))}
                  />
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

      {editing && (
        <EditUserDrawer
          user={editing}
          onClose={() => setEditing(null)}
          onSave={async (role) => {
            const u = editing;
            setEditing(null);
            if (role !== u.role) await run(`u${u.id}`, () => usersApi.update(session.api, u.id, { role }), `${u.name} is now ${roleLabel(role)}.`);
          }}
        />
      )}
    </div>
  );
}

function RoleRow({ role, users, open, onToggle }: { role: AssignableRole; users: number; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr>
        <td>
          <strong>{roleLabel(role)}</strong>
        </td>
        <td className="ee-manage-desc">{ROLE_INFO[role]?.description}</td>
        <td>{users}</td>
        <td>
          <button type="button" className="ee-link-btn" onClick={onToggle} aria-expanded={open}>
            {open ? "Hide access" : "View access"}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="ee-manage-access-row">
          <td colSpan={4}>
            <AccessTable role={role} />
          </td>
        </tr>
      )}
    </>
  );
}

function AccessTable({ role }: { role: string }) {
  return (
    <ul className="ee-manage-access">
      {roleAccess(role).map((a) => (
        <li key={a.label}>
          <span>{a.label}</span>
          <span className={`ee-manage-access-level ${a.access === "Full" ? "full" : a.access === "None" ? "none" : "view"}`}>{a.access}</span>
        </li>
      ))}
    </ul>
  );
}

function EditUserDrawer({ user, onClose, onSave }: { user: ManagedUser; onClose: () => void; onSave: (role: AssignableRole) => void }) {
  const [role, setRole] = useState<AssignableRole>(
    (ASSIGNABLE_ROLES as readonly string[]).includes(user.role) ? (user.role as AssignableRole) : "ACCOUNTANT",
  );
  return (
    <Drawer
      title={`Edit ${user.name}`}
      subtitle={user.email}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onSave(role)} disabled={role === user.role}>
            Save
          </button>
        </>
      }
    >
      <fieldset className="ee-manage-role-pick">
        <legend>Role</legend>
        {ASSIGNABLE_ROLES.map((r) => (
          <label key={r} className={role === r ? "selected" : undefined}>
            <input type="radio" name="role" value={r} checked={role === r} onChange={() => setRole(r)} />
            <span>
              <strong>{roleLabel(r)}</strong>
              <small>{ROLE_INFO[r]?.description}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <h3 className="ee-manage-sub">What {roleLabel(role)} can do</h3>
      <AccessTable role={role} />
    </Drawer>
  );
}
