import { ChevronDown, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { useFeedback } from "../components/feedback";
import { Link, navigate, useLocation } from "../lib/router";
import { useSession } from "../lib/session";
import {
  CUSTOM_ROLE_ERP_ROLES,
  PERMISSION_AREAS,
  ROLE_TEMPLATES,
  accessFromCapabilities,
  roleLabel,
  toggleCapability,
  usersApi,
  type CustomRole,
  type CustomRoleErpRole,
} from "../lib/users";
import { capabilitiesForRole } from "@exceledge/accounting-domain-web";

/**
 * Add or edit a custom role (QuickBooks model): name it, say what it does, choose the Excel Edge
 * access it carries, then tick exactly what it can view or change in Accounting.
 * New roles can start from a suggested template (?template=invoices), a built-in role
 * (?from=ACCOUNTANT) or an existing custom role (?copy=<id>).
 */
export function RoleEditor({ id }: { id?: string }) {
  const session = useSession();
  const { toast, confirm } = useFeedback();
  const { query } = useLocation();
  const [loading, setLoading] = useState(true);
  const [existing, setExisting] = useState<CustomRole | null>(null);
  const [grantable, setGrantable] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [erpRole, setErpRole] = useState<CustomRoleErpRole>("ACCOUNTANT");
  const [caps, setCaps] = useState<string[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const canManage = session.can("setup:approve");
  const templateKey = query.get("template");
  const fromRole = query.get("from");
  const copyId = query.get("copy");

  useEffect(() => {
    usersApi
      .roles(session.api)
      .then(({ roles, grantable: g }) => {
        setGrantable(g);
        const allowed = (list: readonly string[]) => list.filter((c) => g.includes(c));
        if (id) {
          const role = roles.find((r) => r.id === id);
          if (!role) return setError("This role no longer exists.");
          setExisting(role);
          setName(role.name);
          setDescription(role.description ?? "");
          setErpRole(role.erpRole);
          setCaps(allowed(role.capabilities));
        } else if (copyId) {
          const role = roles.find((r) => r.id === copyId);
          if (role) {
            setName(`Copy of ${role.name}`);
            setDescription(role.description ?? "");
            setErpRole(role.erpRole);
            setCaps(allowed(role.capabilities));
          }
        } else if (fromRole) {
          setName(`Custom ${roleLabel(fromRole)}`);
          setCaps(allowed(capabilitiesForRole(fromRole)));
          if (fromRole === "BRANCH_MANAGER" || fromRole === "SELLER") setErpRole(fromRole);
        } else if (templateKey) {
          const t = ROLE_TEMPLATES.find((x) => x.key === templateKey);
          if (t) {
            setName(t.name);
            setDescription(t.description);
            setErpRole(t.erpRole);
            setCaps(allowed(t.capabilities));
          }
        }
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [session.api, id, copyId, fromRole, templateKey]);

  // Open every area that already has something ticked, so the starting point is visible.
  useEffect(() => {
    if (loading) return;
    setOpen((o) => {
      const next = { ...o };
      for (const a of PERMISSION_AREAS) if (next[a.key] === undefined) next[a.key] = a.items.some((i) => caps.includes(i.capability));
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const summary = useMemo(() => accessFromCapabilities(caps), [caps]);
  const nameError = touched && name.trim().length < 2 ? "Give the role a name" : "";
  const capsError = touched && caps.length === 0 ? "Choose at least one thing this role can do" : "";

  function setArea(areaKey: string, on: boolean) {
    const area = PERMISSION_AREAS.find((a) => a.key === areaKey)!;
    setCaps((current) => {
      let next = [...current];
      for (const i of area.items) if (grantable.includes(i.capability)) next = toggleCapability(next, i.capability, on);
      return next;
    });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (name.trim().length < 2 || caps.length === 0) return;
    setBusy(true);
    setError("");
    const input = { name: name.trim(), description: description.trim() || null, capabilities: caps, erpRole };
    try {
      if (existing) {
        const saved = await usersApi.updateRole(session.api, existing.id, input);
        toast(
          saved.holdersUpdated
            ? `"${saved.name}" saved. ${saved.holdersUpdated} ${saved.holdersUpdated === 1 ? "person's" : "people's"} Excel Edge access was updated.`
            : `"${saved.name}" saved.`,
        );
      } else {
        const created = await usersApi.createRole(session.api, input);
        toast(`"${created.name}" created. You can now give it to people.`);
      }
      navigate("/users/roles");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    const ok = await confirm({
      title: `Delete "${existing.name}"?`,
      body: "The role is removed for good. This can't be undone.",
      confirmLabel: "Delete role",
      danger: true,
    });
    if (!ok) return;
    try {
      await usersApi.deleteRole(session.api, existing.id);
      toast(`"${existing.name}" deleted.`);
      navigate("/users/roles");
    } catch (err) {
      toast((err as Error).message, { error: true });
    }
  }

  if (!canManage)
    return (
      <div className="ee-manage">
        <header className="ee-manage-head">
          <div>
            <h1>Custom roles</h1>
            <p>Only a company admin can add or change roles.</p>
          </div>
        </header>
        <Link to="/users/roles" className="ee-link-btn ee-manage-back">
          ← Back to roles
        </Link>
      </div>
    );

  return (
    <form className="ee-manage" onSubmit={(e) => void save(e)} noValidate>
      <div className="ee-manage-crumb">
        <Link to="/users">Users</Link>
        <span>/</span>
        <Link to="/users/roles">Roles</Link>
        <span>/</span>
        <span>{existing ? existing.name : "Add role"}</span>
      </div>

      <header className="ee-manage-head ee-manage-head-row">
        <div>
          <h1>{existing ? "Edit role" : "Add role"}</h1>
          <p>Choose exactly what people with this role can view and change.</p>
        </div>
        {existing && (
          <button type="button" className="btn ee-btn-danger-ghost" onClick={() => void remove()} disabled={existing.users > 0 || existing.pendingInvites > 0} title={existing.users > 0 ? "Give its people another role first" : undefined}>
            <Trash2 size={15} aria-hidden="true" /> Delete role
          </button>
        )}
      </header>

      {error && (
        <div className="ee-manage-alert" role="alert">
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <p className="ee-manage-muted">Loading…</p>
      ) : (
        <div className="ee-role-layout">
          <div className="ee-role-main">
            <section className="ee-manage-form-card">
              <h2>Role details</h2>
              <div className="ee-manage-form-grid ee-role-details">
                <label>
                  <span>
                    Role name <span className="req">*</span>
                  </span>
                  <input className={`input ${nameError ? "invalid" : ""}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Invoice clerk" aria-invalid={Boolean(nameError)} />
                  {nameError && <span className="field-error">{nameError}</span>}
                </label>
                <label className="ee-role-desc">
                  <span>Description</span>
                  <textarea className="input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="What does this person do?" />
                </label>
              </div>
            </section>

            <section className="ee-manage-form-card">
              <h2>Excel Edge access</h2>
              <p className="ee-manage-form-blurb">What people with this role can do in Excel Edge outside Accounting.</p>
              <fieldset className="ee-manage-role-pick ee-role-erp">
                <legend className="sr-only">Excel Edge access</legend>
                {CUSTOM_ROLE_ERP_ROLES.map((r) => (
                  <label key={r.value} className={erpRole === r.value ? "selected" : undefined}>
                    <input type="radio" name="erpRole" checked={erpRole === r.value} onChange={() => setErpRole(r.value)} />
                    <span>
                      <strong>{r.label}</strong>
                      <small>{r.description}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
            </section>

            <section className="ee-manage-form-card">
              <h2>
                Accounting permissions <span className="req">*</span>
              </h2>
              <p className="ee-manage-form-blurb">Changing something also lets them view it. Managing users always stays with company admins.</p>
              {capsError && <span className="field-error">{capsError}</span>}
              <div className="ee-role-areas">
                {PERMISSION_AREAS.map((area) => {
                  const items = area.items.filter((i) => grantable.includes(i.capability));
                  const count = items.filter((i) => caps.includes(i.capability)).length;
                  const all = count === items.length && items.length > 0;
                  const isOpen = open[area.key] ?? false;
                  return (
                    <div key={area.key} className={`ee-role-area ${isOpen ? "open" : ""}`}>
                      <div className="ee-role-area-head">
                        <label className="ee-role-check">
                          <input
                            type="checkbox"
                            checked={all}
                            ref={(el) => {
                              if (el) el.indeterminate = count > 0 && !all;
                            }}
                            onChange={(e) => setArea(area.key, e.target.checked)}
                            aria-label={`All of ${area.label}`}
                          />
                        </label>
                        <button type="button" className="ee-role-area-toggle" onClick={() => setOpen((o) => ({ ...o, [area.key]: !isOpen }))} aria-expanded={isOpen}>
                          <span>
                            <strong>{area.label}</strong>
                            <small>{area.description}</small>
                          </span>
                          <span className="ee-role-area-count">
                            {count} of {items.length}
                            <ChevronDown size={16} aria-hidden="true" />
                          </span>
                        </button>
                      </div>
                      {isOpen && (
                        <ul className="ee-role-items">
                          {items.map((i) => (
                            <li key={i.capability}>
                              <label className="ee-role-check">
                                <input type="checkbox" checked={caps.includes(i.capability)} onChange={(e) => setCaps((c) => toggleCapability(c, i.capability, e.target.checked))} />
                                <span>{i.label}</span>
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          <aside className="ee-role-summary" aria-label="Summary">
            <h2>Summary</h2>
            <p className="ee-manage-muted">{caps.length} permissions selected</p>
            <ul className="ee-manage-access">
              {summary.map((a) => (
                <li key={a.label}>
                  <span>{a.label}</span>
                  <span className={`ee-manage-access-level ${a.access === "Full" ? "full" : a.access === "None" ? "none" : "view"}`}>{a.access}</span>
                </li>
              ))}
            </ul>
            {existing && existing.users > 0 && (
              <p className="ee-role-note">
                {existing.users} {existing.users === 1 ? "person has" : "people have"} this role. Changes apply to them straight away.
              </p>
            )}
          </aside>
        </div>
      )}

      <footer className="ee-manage-form-foot">
        <button type="button" className="btn ee-btn-outline-blue" onClick={() => navigate("/users/roles")}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || loading}>
          {busy ? "Saving…" : existing ? "Save role" : "Create role"}
        </button>
      </footer>
    </form>
  );
}
