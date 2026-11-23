import { Building2, Info, Plus, RefreshCw, Search, Users } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useFeedback } from "../components/feedback";
import { Drawer, Menu } from "../components/ui";
import { Link, navigate, useLocation } from "../lib/router";
import { useSession } from "../lib/session";
import {
  ASSIGNABLE_ROLES,
  CUSTOM_ROLE_ERP_ROLES,
  ROLE_INFO,
  ROLE_TEMPLATES,
  accessFromCapabilities,
  avatarFor,
  personRoleLabel,
  roleAccess,
  roleLabel,
  usersApi,
  type AccountingFirm,
  type AreaAccess,
  type AssignableRole,
  type CustomRole,
  type ManagedUser,
  type PendingInvitation,
  type UsersPayload,
} from "../lib/users";

type Tab = "users" | "roles" | "firms";
type StatusFilter = "all" | "ACTIVE" | "INACTIVE" | "INVITED";
/** A role picked in the Edit panel: built-in or custom. */
export type PickedRole = { kind: "builtin"; role: AssignableRole } | { kind: "custom"; id: string };

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
  NOT_CONNECTED: { label: "Not connected", tone: "inactive" },
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
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [firms, setFirms] = useState<AccountingFirm[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const [transferring, setTransferring] = useState(false);
  const [openRole, setOpenRole] = useState<string | null>(null);

  const canManage = session.can("setup:approve");
  const isSystemOwner = session.role?.toUpperCase() === "SYSTEM_OWNER";
  const myEmail = session.email?.toLowerCase();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [list, roles] = await Promise.all([usersApi.list(session.api), usersApi.roles(session.api)]);
      setData(list);
      setCustomRoles(roles.roles);
      if (tab === "firms") setFirms(await usersApi.firms(session.api));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [session.api, tab]);

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

  const builtInCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const u of data?.users ?? []) if (u.status === "ACTIVE" && !u.customRole) counts.set(u.role, (counts.get(u.role) ?? 0) + 1);
    return counts;
  }, [data]);

  const me = data?.users.find((u) => u.email.toLowerCase() === myEmail);
  const otherAdmins = (data?.users ?? []).filter((u) => u.role === "ADMIN" && u.status === "ACTIVE" && u.email.toLowerCase() !== myEmail);
  const activeCount = data?.users.filter((u) => u.status === "ACTIVE").length ?? 0;

  function userActions(u: ManagedUser) {
    if (!canManage) return <span className="ee-manage-muted">—</span>;
    if (u.isOwner) {
      if (u.email.toLowerCase() !== myEmail) return <span className="ee-manage-muted">—</span>;
      return (
        <button
          type="button"
          className="btn ee-btn-outline-blue btn-sm"
          onClick={() => setTransferring(true)}
          disabled={otherAdmins.length === 0}
          title={otherAdmins.length === 0 ? "Make someone else a company admin first" : undefined}
        >
          Transfer primary admin
        </button>
      );
    }
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

  function roleActions(r: CustomRole) {
    if (!canManage) return <span className="ee-manage-muted">—</span>;
    return (
      <span className="ee-manage-action-split">
        <button type="button" className="btn ee-btn-outline-blue btn-sm" onClick={() => navigate(`/users/roles/${r.id}`)}>
          Edit
        </button>
        <Menu
          label=""
          ariaLabel={`More actions for ${r.name}`}
          triggerClassName="btn ee-btn-outline-blue btn-sm ee-manage-split-caret"
          items={[
            { label: "Duplicate", onSelect: () => navigate(`/users/roles/new?copy=${r.id}`) },
            {
              label: "Delete",
              onSelect: async () => {
                if (r.users > 0) return toast(`${r.users} ${r.users === 1 ? "person has" : "people have"} this role. Give them another role first.`, { error: true });
                const ok = await confirm({ title: `Delete "${r.name}"?`, body: "The role is removed for good. This can't be undone.", confirmLabel: "Delete role", danger: true });
                if (ok) void run(`r${r.id}`, () => usersApi.deleteRole(session.api, r.id), `"${r.name}" deleted.`);
              },
            },
          ]}
        />
      </span>
    );
  }

  const subtitle =
    tab === "roles"
      ? "See what each role can do, and create your own."
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

      {error && (
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
              <select className="input ee-manage-filter" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)} aria-label="Filter by status">
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
                              {u.firmName && <span className="ee-manage-tag firm">{u.firmName}</span>}
                            </span>
                          </span>
                        </td>
                        <td>{u.email}</td>
                        <td>
                          <StatusChip status={u.status} />
                        </td>
                        <td>
                          {personRoleLabel(u)}
                          {u.customRole && <span className="ee-manage-sublabel">Custom role</span>}
                        </td>
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
                            {i.firmName && <span className="ee-manage-tag firm">{i.firmName}</span>}
                          </span>
                        </span>
                      </td>
                      <td>{i.email}</td>
                      <td>
                        <StatusChip status={i.status} />
                      </td>
                      <td>{personRoleLabel(i)}</td>
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
          <div className="ee-manage-toolbar">
            <div className="ee-manage-note">
              <Info size={16} strokeWidth={1.5} aria-hidden="true" />
              <span>Built-in roles can't be changed. Create a custom role to choose access area by area.</span>
            </div>
            {canManage && (
              <div className="ee-manage-toolbar-right">
                <Menu
                  label={
                    <>
                      <Plus size={16} strokeWidth={1.75} aria-hidden="true" /> Add role
                    </>
                  }
                  triggerClassName="btn btn-primary"
                  header="Start from"
                  items={[
                    { label: "A blank role", onSelect: () => navigate("/users/roles/new") },
                    ...ROLE_TEMPLATES.map((t) => ({ label: `Suggested: ${t.name}`, onSelect: () => navigate(`/users/roles/new?template=${t.key}`) })),
                    ...ASSIGNABLE_ROLES.filter((r) => r !== "ADMIN" && r !== "SELLER").map((r) => ({
                      label: `Copy of ${roleLabel(r)}`,
                      onSelect: () => navigate(`/users/roles/new?from=${r}`),
                    })),
                  ]}
                />
              </div>
            )}
          </div>

          <h2 className="ee-manage-section">Custom roles</h2>
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
                {customRoles.length === 0 && (
                  <tr>
                    <td colSpan={5} className="ee-manage-muted">
                      No custom roles yet. {canManage && "Use Add role to create one, for example Invoices only."}
                    </td>
                  </tr>
                )}
                {customRoles.map((r) => (
                  <RoleRow
                    key={r.id}
                    name={r.name}
                    description={r.description ?? `${r.capabilities.length} permissions · ${CUSTOM_ROLE_ERP_ROLES.find((x) => x.value === r.erpRole)?.label ?? ""} in Excel Edge`}
                    users={r.users}
                    updated={formatDate(r.updatedAt)}
                    access={accessFromCapabilities(r.capabilities)}
                    open={openRole === r.id}
                    onToggle={() => setOpenRole((o) => (o === r.id ? null : r.id))}
                    action={roleActions(r)}
                  />
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="ee-manage-section">Built-in roles</h2>
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
                {ASSIGNABLE_ROLES.map((r) => (
                  <RoleRow
                    key={r}
                    name={roleLabel(r)}
                    description={ROLE_INFO[r]?.description ?? ""}
                    users={builtInCounts.get(r) ?? 0}
                    updated="—"
                    access={roleAccess(r)}
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
        <FirmsTab
          firms={firms}
          loading={loading}
          canManage={canManage}
          onRemove={async (f) => {
            const ok = await confirm({
              title: `Remove ${f.firmName}?`,
              body: f.status === "INVITED" || f.status === "EXPIRED" ? "Their invitation will stop working." : "They lose access to this company straight away. Their past work stays in the books.",
              confirmLabel: "Remove firm",
              danger: true,
            });
            if (ok) void run(`f${f.id}`, () => usersApi.removeFirm(session.api, f.id), `${f.firmName} was removed.`);
          }}
        />
      )}

      {editing && (
        <EditUserDrawer
          user={editing}
          customRoles={customRoles}
          onClose={() => setEditing(null)}
          onSave={async (pick) => {
            const u = editing;
            setEditing(null);
            const label = pick.kind === "custom" ? customRoles.find((r) => r.id === pick.id)?.name : roleLabel(pick.role);
            await run(
              `u${u.id}`,
              () => usersApi.update(session.api, u.id, pick.kind === "custom" ? { customRoleId: pick.id } : { role: pick.role }),
              `${u.name} is now ${label}.`,
            );
          }}
        />
      )}

      {transferring && me && (
        <TransferDrawer
          admins={otherAdmins}
          onClose={() => setTransferring(false)}
          onTransfer={async (u) => {
            const ok = await confirm({
              title: `Make ${u.name} the primary admin?`,
              body: "They'll be the main contact and the only one who can hand this role on. You stay a company admin.",
              confirmLabel: "Transfer",
            });
            if (!ok) return;
            setTransferring(false);
            await run(`u${u.id}`, () => usersApi.transferPrimaryAdmin(session.api, u.id), `${u.name} is now the primary admin.`);
          }}
        />
      )}
    </div>
  );
}

function RoleRow({
  name,
  description,
  users,
  updated,
  access,
  open,
  onToggle,
  action,
}: {
  name: string;
  description: string;
  users: number;
  updated: string;
  access: AreaAccess[];
  open: boolean;
  onToggle: () => void;
  action?: ReactNode;
}) {
  return (
    <>
      <tr>
        <td>
          <strong>{name}</strong>
        </td>
        <td className="ee-manage-desc">{description}</td>
        <td>{users}</td>
        <td>{updated}</td>
        <td>
          <span className="ee-manage-role-actions">
            {action}
            <button type="button" className="ee-link-btn" onClick={onToggle} aria-expanded={open}>
              {open ? "Hide access" : "View access"}
            </button>
          </span>
        </td>
      </tr>
      {open && (
        <tr className="ee-manage-access-row">
          <td colSpan={5}>
            <AccessList access={access} />
          </td>
        </tr>
      )}
    </>
  );
}

export function AccessList({ access }: { access: AreaAccess[] }) {
  return (
    <ul className="ee-manage-access">
      {access.map((a) => (
        <li key={a.label}>
          <span>{a.label}</span>
          <span className={`ee-manage-access-level ${a.access === "Full" ? "full" : a.access === "None" ? "none" : "view"}`}>{a.access}</span>
        </li>
      ))}
    </ul>
  );
}

function FirmsTab({
  firms,
  loading,
  canManage,
  onRemove,
}: {
  firms: AccountingFirm[] | null;
  loading: boolean;
  canManage: boolean;
  onRemove: (f: AccountingFirm) => void;
}) {
  if (loading && !firms) return <p className="ee-manage-muted">Loading accounting firms…</p>;
  if (!firms || firms.length === 0)
    return (
      <div className="ee-manage-empty-card">
        <div className="ee-manage-empty-art" aria-hidden="true">
          <div className="ee-manage-empty-blob" />
          <Users size={48} strokeWidth={1.25} />
        </div>
        <h2>Better business starts with your accountant.</h2>
        <p>Invite your accounting firm to work on your books with Accountant access.</p>
        <p className="ee-manage-empty-note">No accounting firms have been added yet.</p>
        {canManage && (
          <button type="button" className="btn btn-primary" onClick={() => navigate("/users/accounting-firms/invite")}>
            <Plus size={16} strokeWidth={1.75} aria-hidden="true" /> Invite firm
          </button>
        )}
      </div>
    );
  return (
    <>
      {canManage && (
        <div className="ee-manage-toolbar">
          <span />
          <div className="ee-manage-toolbar-right">
            <button type="button" className="btn btn-primary" onClick={() => navigate("/users/accounting-firms/invite")}>
              <Plus size={16} strokeWidth={1.75} aria-hidden="true" /> Invite firm
            </button>
          </div>
        </div>
      )}
      <div className="ee-manage-card">
        <table className="ee-manage-table">
          <thead>
            <tr>
              <th>Firm</th>
              <th>Contact</th>
              <th>Status</th>
              <th>Invited</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {firms.map((f) => (
              <tr key={f.id}>
                <td>
                  <span className="ee-manage-user">
                    <span className="ee-manage-avatar firm" aria-hidden="true">
                      <Building2 size={16} />
                    </span>
                    {f.firmName}
                  </span>
                </td>
                <td>
                  {f.contactName && <div>{f.contactName}</div>}
                  <span className="ee-manage-muted">{f.email}</span>
                </td>
                <td>
                  <StatusChip status={f.status} />
                </td>
                <td>{formatDate(f.invitedAt)}</td>
                <td>
                  {canManage ? (
                    <button type="button" className="btn ee-btn-outline-blue btn-sm" onClick={() => onRemove(f)}>
                      Remove
                    </button>
                  ) : (
                    <span className="ee-manage-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Role picker shared by Edit user and Add user: built-in roles first, then custom roles. */
export function RolePicker({ value, onChange, customRoles, includeAdmin = true }: { value: PickedRole | null; onChange: (p: PickedRole) => void; customRoles: CustomRole[]; includeAdmin?: boolean }) {
  const builtIns = ASSIGNABLE_ROLES.filter((r) => includeAdmin || r !== "ADMIN");
  return (
    <fieldset className="ee-manage-role-pick">
      <legend className="sr-only">Role</legend>
      {builtIns.map((r) => {
        const selected = value?.kind === "builtin" && value.role === r;
        return (
          <label key={r} className={selected ? "selected" : undefined}>
            <input type="radio" name="role" checked={selected} onChange={() => onChange({ kind: "builtin", role: r })} />
            <span>
              <strong>{roleLabel(r)}</strong>
              <small>{ROLE_INFO[r]?.description}</small>
            </span>
          </label>
        );
      })}
      {customRoles.length > 0 && <div className="ee-manage-pick-group">Custom roles</div>}
      {customRoles.map((r) => {
        const selected = value?.kind === "custom" && value.id === r.id;
        return (
          <label key={r.id} className={selected ? "selected" : undefined}>
            <input type="radio" name="role" checked={selected} onChange={() => onChange({ kind: "custom", id: r.id })} />
            <span>
              <strong>{r.name}</strong>
              <small>{r.description || `${r.capabilities.length} permissions`}</small>
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}

export function accessForPick(pick: PickedRole | null, customRoles: CustomRole[]): AreaAccess[] | null {
  if (!pick) return null;
  if (pick.kind === "builtin") return roleAccess(pick.role);
  const r = customRoles.find((x) => x.id === pick.id);
  return r ? accessFromCapabilities(r.capabilities) : null;
}

function EditUserDrawer({ user, customRoles, onClose, onSave }: { user: ManagedUser; customRoles: CustomRole[]; onClose: () => void; onSave: (p: PickedRole) => void }) {
  const initial: PickedRole = user.customRole
    ? { kind: "custom", id: user.customRole.id }
    : { kind: "builtin", role: (ASSIGNABLE_ROLES as readonly string[]).includes(user.role) ? (user.role as AssignableRole) : "ACCOUNTANT" };
  const [pick, setPick] = useState<PickedRole>(initial);
  const unchanged = JSON.stringify(pick) === JSON.stringify(initial);
  const access = accessForPick(pick, customRoles);
  const pickName = pick.kind === "custom" ? customRoles.find((r) => r.id === pick.id)?.name : roleLabel(pick.role);
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
          <button type="button" className="btn btn-primary" onClick={() => onSave(pick)} disabled={unchanged}>
            Save
          </button>
        </>
      }
    >
      <h3 className="ee-manage-sub ee-manage-sub-first">Role</h3>
      <RolePicker value={pick} onChange={setPick} customRoles={customRoles} />
      {access && (
        <>
          <h3 className="ee-manage-sub">What {pickName} can do</h3>
          <AccessList access={access} />
        </>
      )}
    </Drawer>
  );
}

function TransferDrawer({ admins, onClose, onTransfer }: { admins: ManagedUser[]; onClose: () => void; onTransfer: (u: ManagedUser) => void }) {
  const [chosen, setChosen] = useState<number | null>(null);
  const target = admins.find((a) => a.id === chosen);
  return (
    <Drawer
      title="Transfer primary admin"
      subtitle="Choose another company admin to become the primary admin."
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" disabled={!target} onClick={() => target && onTransfer(target)}>
            Continue
          </button>
        </>
      }
    >
      <fieldset className="ee-manage-role-pick">
        <legend className="sr-only">New primary admin</legend>
        {admins.map((a) => (
          <label key={a.id} className={chosen === a.id ? "selected" : undefined}>
            <input type="radio" name="owner" checked={chosen === a.id} onChange={() => setChosen(a.id)} />
            <span>
              <strong>{a.name}</strong>
              <small>{a.email}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="ee-manage-muted ee-manage-transfer-note">Only company admins can become the primary admin. You'll stay a company admin.</p>
    </Drawer>
  );
}
