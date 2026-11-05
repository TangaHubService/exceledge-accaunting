import { ChevronDown, ChevronRight, Copy, ExternalLink, Gem, MoreVertical, Pencil, Printer, Sparkles, Star, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useFeedback } from "../../components/feedback";
import { AskQuestion, CreateReportButton, ReportPicker, RpSelect } from "../../components/reports/kit";
import { Drawer, Menu } from "../../components/ui";
import { date } from "../../lib/format";
import {
  type CustomReport,
  MANAGEMENT_SECTIONS,
  type ManagementReport,
  monthLong,
  PERIODS,
  type PeriodKey,
  periodRange,
  type ReportEntry,
  reportHref,
  REPORT_SECTIONS,
  SYSTEM_MANAGEMENT_REPORTS,
  useFavourites,
} from "../../lib/reports";
import { Link, navigate, setQueryParam, useLocation } from "../../lib/router";
import { useSession } from "../../lib/session";
import { newId, removeLocal, saveLocal, useLocalCollection } from "../../lib/txn";

/* ── Standard reports (173–178) ─────────────────────────── */

function ReportRow({ entry }: { entry: ReportEntry }) {
  const { isFavourite, toggle } = useFavourites();
  const on = isFavourite(entry.name);
  return (
    <li className="rp-report-row">
      <Link to={reportHref(entry)}>{entry.name}</Link>
      <button type="button" className={`rp-star ${on ? "on" : ""}`} onClick={() => toggle(entry.name)} aria-pressed={on} aria-label={`${on ? "Remove" : "Add"} ${entry.name} ${on ? "from" : "to"} favourites`}>
        <Star size={20} strokeWidth={1.6} fill={on ? "currentColor" : "none"} aria-hidden="true" />
      </button>
      <Menu
        label={<MoreVertical size={18} aria-hidden="true" />}
        ariaLabel={`Actions for ${entry.name}`}
        triggerClassName="rp-kebab"
        items={[
          { label: "Open report", icon: ExternalLink, onSelect: () => navigate(reportHref(entry)) },
          { label: on ? "Remove from favourites" : "Add to favourites", icon: Star, onSelect: () => toggle(entry.name) },
        ]}
      />
    </li>
  );
}

function ReportSectionCard({ title, badge, learnMore, hint, left, right, onCreate }: (typeof REPORT_SECTIONS)[number] & { onCreate?: () => void }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="rp-section">
      <header>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={`${open ? "Collapse" : "Expand"} ${title}`}>
          {open ? <ChevronDown size={20} aria-hidden="true" /> : <ChevronRight size={20} aria-hidden="true" />}
        </button>
        <h2>{title}</h2>
        {badge && <span className="rp-new">{badge}</span>}
        {learnMore && (
          <Link to="/employees" className="rp-learn">
            <Gem size={18} strokeWidth={1.6} aria-hidden="true" /> {learnMore}
          </Link>
        )}
      </header>
      {open && (
        <>
          {hint && (
            <p className="rp-section-hint">
              {hint}{" "}
              <button type="button" className="rp-link rp-underline" onClick={onCreate}>
                Create new report
              </button>
            </p>
          )}
          <div className="rp-report-cols">
            <ul>
              {left.map((e) => (
                <ReportRow key={e.name} entry={e} />
              ))}
            </ul>
            <ul>
              {right.map((e) => (
                <ReportRow key={e.name} entry={e} />
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}

export function StandardReports() {
  const { favourites } = useFavourites();
  const lastMonth = periodRange("LAST_MONTH");
  return (
    <div className="rp-page">
      <div className="rp-toolbar">
        <ReportPicker />
        <div className="rp-actions">
          <AskQuestion beta />
          <CreateReportButton />
        </div>
      </div>
      <div className="rp-banner">
        <Sparkles size={20} aria-hidden="true" />
        <span>I generated a financial summary for {monthLong(lastMonth.from.slice(0, 7))} to give you key insights into your finances.</span>
        <Link to="/reports/management/company-overview?period=LAST_MONTH">Review Summary</Link>
      </div>
      <ReportSectionCard title="Favourites" left={favourites} right={[]} />
      {favourites.length === 0 && <p className="rp-muted rp-pad">Star a report below to keep it here.</p>}
      {REPORT_SECTIONS.map((s) => (
        <ReportSectionCard key={s.title} {...s} onCreate={() => document.querySelector<HTMLButtonElement>(".rp-split > .rp-btn")?.click()} />
      ))}
    </div>
  );
}

/* ── Custom reports (179–180) ───────────────────────────── */

export function CustomReports() {
  const { toast, confirm } = useFeedback();
  const rows = useLocalCollection<CustomReport>("custom-reports");
  const [page, setPage] = useState(0);
  const pageSize = 10;
  const last = Math.max(0, Math.ceil(rows.length / pageSize) - 1);
  const shown = rows.slice(page * pageSize, page * pageSize + pageSize);
  const start = rows.length ? page * pageSize + 1 : 0;
  const end = Math.min(rows.length, (page + 1) * pageSize);

  async function remove(r: CustomReport) {
    if (await confirm({ title: `Delete ${r.name}?`, body: "This removes the saved report from this device.", confirmLabel: "Delete", danger: true })) {
      removeLocal("custom-reports", r.id);
      toast("Report deleted.");
    }
  }

  return (
    <div className="rp-page">
      <div className="rp-toolbar">
        <ReportPicker />
        <CreateReportButton />
      </div>
      <div className="rp-table-wrap">
        <table className="rp-table">
          <thead>
            <tr>
              <th>Report name</th>
              <th>Created by</th>
              <th>Last Modified By</th>
              <th>Date range</th>
              <th>
                Access <i className="rp-dot" aria-hidden="true" />
              </th>
              <th>Email</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={7} className="rp-empty-row">
                  Reports that you customise and then save will be listed here. Click 'Save Customisations' at the top of the report.
                </td>
              </tr>
            ) : (
              shown.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link to={`/reports/view/${r.slug}?saved=${r.id}`}>{r.name}</Link>
                  </td>
                  <td>{r.createdBy}</td>
                  <td>{r.modifiedBy}</td>
                  <td>{r.from || r.to ? `${r.from ? date(r.from) : "Start"} – ${r.to ? date(r.to) : "Today"}` : "All dates"}</td>
                  <td>Private</td>
                  <td>—</td>
                  <td>
                    <Menu
                      label="Run"
                      triggerClassName="rp-link rp-menu-link"
                      items={[
                        { label: "Run report", icon: ExternalLink, onSelect: () => navigate(`/reports/view/${r.slug}?saved=${r.id}`) },
                        { label: "Delete", icon: Trash2, onSelect: () => void remove(r) },
                      ]}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <nav className="rp-pager" aria-label="Pages">
        <button type="button" disabled={page === 0} onClick={() => setPage(0)}>
          First
        </button>
        <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>
          {start} - {end}
        </span>
        <button type="button" disabled={page >= last} onClick={() => setPage(page + 1)}>
          Next
        </button>
        <button type="button" disabled={page >= last} onClick={() => setPage(last)}>
          Last
        </button>
      </nav>
    </div>
  );
}

/* ── Management reports (181) ───────────────────────────── */

const blankDraft = (): { id?: string; name: string; period: PeriodKey; sections: string[] } => ({ name: "", period: "THIS_YEAR", sections: ["overview", "pnl"] });

function ManagementDrawer({ initial, onClose }: { initial: ReturnType<typeof blankDraft>; onClose: () => void }) {
  const { email } = useSession();
  const { toast } = useFeedback();
  const [draft, setDraft] = useState(initial);
  const [errors, setErrors] = useState<{ name?: string; sections?: string }>({});

  function save() {
    const next: typeof errors = {};
    if (!draft.name.trim()) next.name = "Give the report a name.";
    if (!draft.sections.length) next.sections = "Choose at least one section.";
    setErrors(next);
    if (next.name || next.sections) return;
    saveLocal<ManagementReport>("management-reports", {
      id: draft.id ?? newId(),
      name: draft.name.trim(),
      period: draft.period,
      sections: draft.sections,
      createdBy: email ?? "You",
      updatedAt: new Date().toISOString(),
    });
    toast("Management report saved.");
    onClose();
  }

  return (
    <Drawer
      title={draft.id ? "Edit management report" : "New management report"}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="rp-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="rp-btn rp-btn-primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <label className="rp-field">
        <span>Report name</span>
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-invalid={Boolean(errors.name)} />
        {errors.name && <small className="rp-error">{errors.name}</small>}
      </label>
      <label className="rp-field">
        <span>Report period</span>
        <RpSelect label="Report period" value={draft.period} options={PERIODS} onChange={(period) => setDraft({ ...draft, period })} />
      </label>
      <fieldset className="rp-field rp-fieldset">
        <legend>Sections</legend>
        {MANAGEMENT_SECTIONS.map((s) => (
          <label key={s.id} className="rp-check">
            <input
              type="checkbox"
              checked={draft.sections.includes(s.id)}
              onChange={(e) => setDraft({ ...draft, sections: e.target.checked ? [...draft.sections, s.id] : draft.sections.filter((x) => x !== s.id) })}
            />
            {s.label}
          </label>
        ))}
        {errors.sections && <small className="rp-error">{errors.sections}</small>}
      </fieldset>
    </Drawer>
  );
}

export function ManagementReports() {
  const { query } = useLocation();
  const { toast, confirm } = useFeedback();
  const custom = useLocalCollection<ManagementReport>("management-reports");
  const [periods, setPeriods] = useState<Record<string, PeriodKey>>({});
  const [draft, setDraft] = useState<ReturnType<typeof blankDraft> | null>(null);

  useEffect(() => {
    if (query.get("new")) {
      setDraft(blankDraft());
      setQueryParam("new", null);
    }
  }, [query]);

  const preview = (id: string, fallback: PeriodKey) => navigate(`/reports/management/${id}?period=${periods[id] ?? fallback}`);
  const duplicate = (name: string, sections: string[], period: PeriodKey) => {
    saveLocal<ManagementReport>("management-reports", { id: newId(), name: `${name} (copy)`, period, sections, createdBy: "You", updatedAt: new Date().toISOString() });
    toast("Copy added to your reports.");
  };

  const row = (r: { id: string; name: string; sections: string[]; system: boolean; createdBy: string; updatedAt?: string; period: PeriodKey }) => (
    <tr key={r.id}>
      <td>
        <span className="rp-report-name">
          {r.name}
          {r.system && <span className="rp-system">SYSTEM REPORT</span>}
        </span>
      </td>
      <td>{r.createdBy}</td>
      <td>{r.updatedAt ? date(r.updatedAt) : ""}</td>
      <td>
        <RpSelect label={`Period for ${r.name}`} value={periods[r.id] ?? r.period} options={PERIODS} onChange={(v) => setPeriods({ ...periods, [r.id]: v })} />
      </td>
      <td>
        <div className="rp-preview-cell">
          <button type="button" className="rp-link rp-strong" onClick={() => preview(r.id, r.period)}>
            Preview
          </button>
          <Menu
            label={null}
            ariaLabel={`More actions for ${r.name}`}
            triggerClassName="rp-caret"
            items={[
              { label: "Print or save as PDF", icon: Printer, onSelect: () => navigate(`/reports/management/${r.id}?period=${periods[r.id] ?? r.period}&print=1`) },
              { label: "Make a copy", icon: Copy, onSelect: () => duplicate(r.name, r.sections, periods[r.id] ?? r.period) },
              !r.system && { label: "Edit", icon: Pencil, onSelect: () => setDraft({ id: r.id, name: r.name, period: r.period, sections: r.sections }) },
              !r.system && {
                label: "Delete",
                icon: Trash2,
                onSelect: () =>
                  void confirm({ title: `Delete ${r.name}?`, confirmLabel: "Delete", danger: true }).then((ok) => {
                    if (ok) removeLocal("management-reports", r.id);
                  }),
              },
            ]}
          />
        </div>
      </td>
    </tr>
  );

  return (
    <div className="rp-page">
      <div className="rp-toolbar rp-toolbar-end">
        <button type="button" className="rp-btn rp-btn-primary rp-btn-lg" onClick={() => setDraft(blankDraft())}>
          + Management report
        </button>
      </div>
      <div className="rp-table-wrap">
        <table className="rp-table rp-table-caps">
          <thead>
            <tr>
              <th>Name</th>
              <th>Created by</th>
              <th>Last modified</th>
              <th>Report period</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {SYSTEM_MANAGEMENT_REPORTS.map((r) => row({ ...r, system: true, createdBy: "System", period: "THIS_YEAR" }))}
            {custom.map((r) => row({ ...r, system: false }))}
          </tbody>
        </table>
      </div>
      {draft && <ManagementDrawer initial={draft} onClose={() => setDraft(null)} />}
    </div>
  );
}
